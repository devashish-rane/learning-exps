# Infra Automation Blueprint

This folder contains a ready-to-adapt blueprint for the "build → regression deploy → sanity test → prod deploy → teardown" flow using GitHub Actions + AWS ECR/ECS/EC2 + CDK.

## Contents

- `workflow-template.yaml` – drop-in GitHub Actions workflow (or reference) for CI/CD. Use as inspiration even if you don't run it.
- `scripts/regression.sh` – local helper to mirror the pipeline end-to-end from a laptop/runner.
- `cdk/` – CDK v2 **Java** app that provisions VPC + ECS (EC2) + ALB and runs the container from a provided ECR image.

## Usage

1. Copy `workflow-template.yaml` to `.github/workflows/regression.yaml` and replace placeholders:
   - `GitHubDeployRole`, stack names, repo names, smoke-test script.
2. Ensure AWS credentials exist (OIDC role or IAM user) with permissions for ECR, ECS, CloudFormation, CloudWatch, EC2, ELB.
3. Install Java CDK deps (Maven):
   ```bash
   cd infra/cdk
   mvn -q -e -DskipTests package
   ```
   (Run this again after you edit the Java CDK code.)
4. Build & run everything locally (no GitHub Actions needed):
   ```bash
   cd infra
   chmod +x scripts/regression.sh
 ./scripts/regression.sh --aws-account 123456789012 --aws-region us-east-1 --image-tag dev-$(git rev-parse --short HEAD)
  ```
   - Script flow: build jar → build Docker image → push to ECR → `cdk deploy` regression stack → curl `/actuator/health` → `cdk destroy` stack.
   - `AWS_SESSION_TOKEN` is only required when you use temporary STS credentials; leave it blank for long-lived IAM users or when using `AWS_PROFILE`.
5. Optional: add richer smoke tests via `infra/scripts/smoke.sh` and call it from the script/workflow.

## CDK App (infra/cdk)

- **Language**: Java 17 + Maven. Requires AWS CDK CLI installed globally (`npm install -g aws-cdk` or via package manager).
- **Stacks**: `CoreServiceStack-<purpose>` (purpose defaults to `regression`, pass `STACK_PURPOSE=prod` for prod test).
- **Resources**:
  - New VPC (2 AZ, 1 NAT GW) + ECS cluster with EC2 capacity (t3.medium instances).
  - ApplicationLoadBalancedEc2Service exposing port 8080 via ALB. Health check = `/actuator/health`.
  - CloudWatch Logs for containers, outputs `AlbDnsName`, `ClusterName`, `ServiceName`.
- **Parameters/env**:
  - Provide image via `ECR_IMAGE_URI` env var or `-c ecrImageUri=...` context. If `ECR_IMAGE_URI` is left blank, the app derives the URI from `CDK_DEFAULT_ACCOUNT/AWS_ACCOUNT_ID`, `CDK_DEFAULT_REGION/AWS_REGION`, `ECR_REPOSITORY`, and `IMAGE_TAG`.
  - Desired task count via `-c desiredCount=2` or CFN parameter.
- **Commands**:
  ```bash
  cd infra/cdk
  mvn -q -e -DskipTests package
  export CDK_DEFAULT_ACCOUNT=123456789012
  export CDK_DEFAULT_REGION=us-east-1
  ECR_IMAGE_URI=123456789012.dkr.ecr.us-east-1.amazonaws.com/core-spring-service:dev-abc123 \
    cdk deploy CoreServiceStack-regression --require-approval never
  # ... test the ALB DNS output ...
  cdk destroy CoreServiceStack-regression --force
  ```

## Workflow Highlights

1. Build Spring Boot JAR → Docker image.
2. Push image to ECR (tagged with branch + SHA).
3. Deploy regression CDK stack parameterized by `ECR_IMAGE_URI`.
4. Wait for ECS service stable and run HTTP smoke tests.
5. Promote image/tag, deploy production stack, then tear down regression stack.
6. Collect CloudWatch metrics/logs and post results (hook for Slack / GH summary).

Feel free to expand the workflow with linting, integration tests, chaos testing, or manual approvals before production deployment.
