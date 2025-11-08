package com.branedev.infra;

import software.amazon.awscdk.App;
import software.amazon.awscdk.Environment;
import software.amazon.awscdk.StackProps;

public class CoreServiceApp {
    public static void main(final String[] args) {
        App app = new App();

        String stackPurpose = (String) app.getNode().tryGetContext("stackPurpose");
        if (stackPurpose == null || stackPurpose.isBlank()) {
            stackPurpose = System.getenv().getOrDefault("STACK_PURPOSE", "regression");
        }

        String imageUri = (String) app.getNode().tryGetContext("ecrImageUri");
        if (imageUri == null || imageUri.isBlank()) {
            imageUri = System.getenv("ECR_IMAGE_URI");
        }

        if (imageUri == null || imageUri.isBlank()) {
            String account = System.getenv("CDK_DEFAULT_ACCOUNT");
            if (account == null || account.isBlank()) {
                account = System.getenv("AWS_ACCOUNT_ID");
            }

            String region = System.getenv("CDK_DEFAULT_REGION");
            if (region == null || region.isBlank()) {
                region = System.getenv("AWS_REGION");
            }

            if (account != null && !account.isBlank() && region != null && !region.isBlank()) {
                String repo = System.getenv().getOrDefault("ECR_REPOSITORY", "core-spring-service");
                String tag = System.getenv().getOrDefault("IMAGE_TAG", "latest");
                imageUri = String.format("%s.dkr.ecr.%s.amazonaws.com/%s:%s", account, region, repo, tag);
            }
        }

        Number desiredCount = null;
        Object ctxDesired = app.getNode().tryGetContext("desiredCount");
        if (ctxDesired instanceof Number n) {
            desiredCount = n;
        } else {
            String envDesired = System.getenv("SERVICE_DESIRED_COUNT");
            if (envDesired != null && !envDesired.isBlank()) {
                desiredCount = Integer.parseInt(envDesired);
            }
        }

        Environment env = Environment.builder()
                .account(System.getenv("CDK_DEFAULT_ACCOUNT"))
                .region(System.getenv("CDK_DEFAULT_REGION"))
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
}
