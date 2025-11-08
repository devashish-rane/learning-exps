package com.branedev.infra;

import io.github.cdimascio.dotenv.Dotenv;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Optional;
import software.amazon.awscdk.App;
import software.amazon.awscdk.Environment;
import software.amazon.awscdk.StackProps;

public class CoreServiceApp {
    public static void main(final String[] args) {
        Dotenv dotenv = Dotenv.configure()
                .directory(resolveEnvDirectory())
                .ignoreIfMissing()
                .load();

        App app = new App();

        String stackPurpose = Optional.ofNullable((String) app.getNode().tryGetContext("stackPurpose"))
                .filter(value -> !value.isBlank())
                .orElseGet(() -> envValue(dotenv, "STACK_PURPOSE").orElse("regression"));

        String imageUri = Optional.ofNullable((String) app.getNode().tryGetContext("ecrImageUri"))
                .filter(value -> !value.isBlank())
                .orElseGet(() -> envValue(dotenv, "ECR_IMAGE_URI").orElse(null));

        String account = firstNonBlank(
                envValue(dotenv, "CDK_DEFAULT_ACCOUNT").orElse(null),
                envValue(dotenv, "AWS_ACCOUNT_ID").orElse(null)
        );

        String region = firstNonBlank(
                envValue(dotenv, "CDK_DEFAULT_REGION").orElse(null),
                envValue(dotenv, "AWS_REGION").orElse(null)
        );

        if (account == null || region == null) {
            throw new IllegalStateException("AWS account and region must be provided via .env or environment variables.");
        }

        if (imageUri == null || imageUri.isBlank()) {
            String repo = envValue(dotenv, "ECR_REPOSITORY").orElse("core-spring-service");
            String tag = envValue(dotenv, "IMAGE_TAG").orElse("latest");
            imageUri = String.format("%s.dkr.ecr.%s.amazonaws.com/%s:%s", account, region, repo, tag);
        }

        Number desiredCount = null;
        Object ctxDesired = app.getNode().tryGetContext("desiredCount");
        if (ctxDesired instanceof Number number) {
            desiredCount = number;
        } else {
            desiredCount = envValue(dotenv, "SERVICE_DESIRED_COUNT")
                    .map(CoreServiceApp::parseDesiredCount)
                    .orElse(null);
        }

        Environment env = Environment.builder()
                .account(account)
                .region(region)
                .build();

        StackProps stackProps = StackProps.builder()
                .env(env)
                .build();

        CoreServiceStackProps serviceProps = CoreServiceStackProps.builder()
                .imageUri(imageUri)
                .desiredCount(desiredCount)
                .build();

        new CoreServiceStack(app, "CoreServiceStack-" + stackPurpose, stackProps, serviceProps);

        app.synth();
    }

    private static Optional<String> envValue(Dotenv dotenv, String key) {
        String value = dotenv.get(key);
        if (value == null) {
            value = System.getenv(key);
        }
        if (value == null) {
            return Optional.empty();
        }
        value = value.trim();
        return value.isEmpty() ? Optional.empty() : Optional.of(value);
    }

    private static String firstNonBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private static Number parseDesiredCount(String raw) {
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("SERVICE_DESIRED_COUNT must be a valid integer", ex);
        }
    }

    private static String resolveEnvDirectory() {
        Path current = Paths.get("").toAbsolutePath();
        Path cursor = current;
        while (cursor != null) {
            if (Files.exists(cursor.resolve(".env"))) {
                return cursor.toString();
            }
            cursor = cursor.getParent();
        }
        return current.toString();
    }
}
