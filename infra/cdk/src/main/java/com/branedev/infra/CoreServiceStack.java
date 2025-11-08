package com.branedev.infra;

import java.util.Map;

import software.amazon.awscdk.CfnOutput;
import software.amazon.awscdk.CfnParameter;
import software.amazon.awscdk.Duration;
import software.amazon.awscdk.Stack;
import software.amazon.awscdk.StackProps;
import software.amazon.awscdk.services.ec2.InstanceClass;
import software.amazon.awscdk.services.ec2.InstanceSize;
import software.amazon.awscdk.services.ec2.InstanceType;
import software.amazon.awscdk.services.ec2.Vpc;
import software.amazon.awscdk.services.ecs.AddCapacityOptions;
import software.amazon.awscdk.services.ecs.Cluster;
import software.amazon.awscdk.services.ecs.ContainerImage;
import software.amazon.awscdk.services.ecs.EcsOptimizedImage;
import software.amazon.awscdk.services.ecs.patterns.ApplicationLoadBalancedEc2Service;
import software.amazon.awscdk.services.ecs.patterns.ApplicationLoadBalancedTaskImageOptions;
import software.amazon.awscdk.services.ecs.LogDrivers;
import software.constructs.Construct;

public class CoreServiceStack extends Stack {
    public CoreServiceStack(final Construct scope, final String id, final StackProps props, final CoreServiceStackProps serviceProps) {
        super(scope, id, props);

        String imageUri = serviceProps.getImageUri();
        Number desiredCountDefault = serviceProps.getDesiredCount();

        CfnParameter imageParam = CfnParameter.Builder.create(this, "EcrImageUri")
                .type("String")
                .description("Full ECR image URI")
                .defaultValue(imageUri != null ? imageUri : "")
                .build();

        CfnParameter desiredCountParam = CfnParameter.Builder.create(this, "ServiceDesiredCount")
                .type("Number")
                .defaultValue(desiredCountDefault != null ? desiredCountDefault : 1)
                .minValue(1)
                .maxValue(5)
                .build();

        Vpc vpc = Vpc.Builder.create(this, "Vpc")
                .maxAzs(2)
                .natGateways(1)
                .build();

        Cluster cluster = Cluster.Builder.create(this, "Cluster")
                .vpc(vpc)
                .containerInsights(true)
                .build();

        cluster.addCapacity("DefaultAsg", AddCapacityOptions.builder()
                .instanceType(InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM))
                .desiredCapacity(2)
                .minCapacity(1)
                .maxCapacity(4)
                .machineImage(EcsOptimizedImage.amazonLinux2())
                .build());

        ApplicationLoadBalancedEc2Service albService = ApplicationLoadBalancedEc2Service.Builder.create(this, "AlbService")
                .cluster(cluster)
                .desiredCount(desiredCountParam.getValueAsNumber())
                .publicLoadBalancer(true)
                .listenerPort(80)
                .healthCheckGracePeriod(Duration.minutes(2))
                .taskImageOptions(ApplicationLoadBalancedTaskImageOptions.builder()
                        .image(ContainerImage.fromRegistry(imageParam.getValueAsString()))
                        .containerPort(8080)
                        .logDriver(LogDrivers.awsLogs(software.amazon.awscdk.services.ecs.AwsLogDriverProps.builder()
                                .streamPrefix("core-svc")
                                .build()))
                        .environment(Map.of(
                                "SPRING_PROFILES_ACTIVE", "cloudwatch,prod"
                        ))
                        .build())
                .build();

        albService.getTargetGroup().configureHealthCheck(builder -> builder
                .path("/actuator/health")
                .healthyHttpCodes("200-399")
                .healthyThresholdCount(2)
                .unhealthyThresholdCount(5)
                .timeout(Duration.seconds(10))
                .interval(Duration.seconds(30))
        );

        CfnOutput.Builder.create(this, "AlbDnsName")
                .value(albService.getLoadBalancer().getLoadBalancerDnsName())
                .build();

        CfnOutput.Builder.create(this, "ClusterName")
                .value(cluster.getClusterName())
                .build();

        CfnOutput.Builder.create(this, "ServiceName")
                .value(albService.getService().getServiceName())
                .build();
    }
}
