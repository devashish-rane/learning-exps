# Infra Automation Blueprint

This folder contains everything needed to provision, test, and tear down the AWS infrastructure for the core Spring service. It supports both manual/local execution and CI/CD automation.

## Contents

- `workflow-template.yaml` – GitHub Actions blueprint implementing build → push → deploy → test → promote → tear down. Treat it as runnable YAML or as pseudo-code for another orchestrator.
- `scripts/stack.sh` – Bash helper that sources the repo root `.env` and exposes three commands (`up`, `down`, `regression`) for day-to-day work.
- `cdk/` – AWS CDK v2 **Java** project that creates the VPC, ECS-on-EC2 cluster, Application Load Balancer, task definition, and CloudWatch logging needed to run the container image.

## Usage

1. Copy `workflow-template.yaml` into `.github/workflows/regression.yaml` (optional) and replace placeholders such as IAM role names, stack names, and smoke-test commands.
2. Configure AWS credentials (OIDC role, IAM user, or STS) with access to ECR, ECS, EC2, CloudFormation, CloudWatch, and ELB.
3. Build the CDK Java app whenever you change infra code:
   ```bash
   cd infra/cdk
   mvn -q -e -DskipTests package
   ```
4. Run the helper script for a full regression cycle (build → push → deploy → health-check → destroy):
   ```bash
   cd infra
   chmod +x scripts/stack.sh
   ./scripts/stack.sh regression --stack-purpose dev-$(git rev-parse --short HEAD) --image-tag dev-$(git rev-parse --short HEAD)
   ```
   - Flow: build jar → build Docker image → push to ECR → `cdk deploy CoreServiceStack-<purpose>` → curl `/actuator/health` → `cdk destroy`.
   - `AWS_SESSION_TOKEN` is only required when using temporary STS credentials; leave it blank otherwise.
5. Optional: add richer smoke tests (e.g., `infra/scripts/smoke.sh`) and invoke them from the workflow or helper script.

## Environment configuration

All tooling (Docker Compose, VS Code, CDK, `stack.sh`, etc.) loads the root `.env`. Update these placeholders once and everything stays in sync:

- `AWS_PROFILE` *or* (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`).
- `AWS_ACCOUNT_ID` / `AWS_REGION` – also used to derive the ECR registry when `ECR_IMAGE_URI` is blank.
- `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`, `STACK_PURPOSE`, `SERVICE_DESIRED_COUNT` – consumed by the CDK app and helper script.
- `ECR_REPOSITORY`, `IMAGE_TAG`, `ECR_IMAGE_URI` – leave `ECR_IMAGE_URI` empty to auto-build `account.dkr.ecr.region.amazonaws.com/<repo>:<tag>`.

Whenever credentials or tags change, update `.env` and rerun `stack.sh`/CDK commands—no other files need edits.

## Helper script (`scripts/stack.sh`)

| Command | Description |
|---------|-------------|
| `./stack.sh up [--stack-purpose foo] [--image-tag tag] [--service-count 2]` | Resolves the ECR image URI (from `.env` or derived) and runs `cdk deploy CoreServiceStack-<purpose>` while leaving the stack running. |
| `./stack.sh down [--stack-purpose foo]` | Issues `cdk destroy --force` for `CoreServiceStack-<purpose>`. |
| `./stack.sh regression [--stack-purpose foo] [--image-tag tag]` | Full loop: build jar, build Docker image, login & push to ECR, deploy stack, curl `/actuator/health`, destroy stack. |

Common flags:
- `--stack-purpose <name>` overrides `STACK_PURPOSE` (default `regression`).
- `--image-tag <tag>` overrides `IMAGE_TAG` when building/publishing.
- `--service-count <n>` overrides desired ECS task count.

Internally the script:
1. Loads `.env`, exports AWS/CDK variables, and validates mandatory values.
2. Builds the CDK project (Maven) before each deploy/destroy to ensure the latest Java code is synthesized.
3. Derives the ECR image URI if `ECR_IMAGE_URI` is blank, using `AWS_ACCOUNT_ID`, `AWS_REGION`, `ECR_REPOSITORY`, and `IMAGE_TAG`.
4. Uses the AWS CLI for ECR login, image push, CloudFormation stack output lookup, and teardown.

## GitHub Actions template (`workflow-template.yaml`)

This workflow mirrors the helper script but splits responsibilities across jobs:

1. **build-and-push** – checkout → `mvn package` → `docker build` → ECR login + push.
2. **regression-deploy** – install Node/CDK (if desired), synth, and deploy the regression stack.
3. **regression-test** – query CloudFormation outputs for the ALB DNS, curl `/actuator/health`, execute smoke tests, and pull CloudWatch metrics.
4. **promote-prod** – retag the image as `prod-*` and deploy the production stack (only runs when prior steps succeed).
5. **teardown-regression** – always destroys the regression stack to prevent orphaned resources.

Copy it into `.github/workflows/` when you are ready for CI/CD, or adapt the command blocks for Jenkins, CodeBuild, etc.

## CDK app (infra/cdk)

- **Language**: Java 17 + Maven. Requires the AWS CDK CLI installed globally (`npm install -g aws-cdk`, Homebrew, etc.).
- **Stacks**: `CoreServiceStack-<purpose>` (defaults to `regression`; set `STACK_PURPOSE=prod` for production).
- **Resources provisioned**:
  - VPC spanning two AZs with one NAT Gateway.
  - ECS cluster (EC2 launch type) with an Auto Scaling Group of t3.medium instances.
  - Application Load Balanced EC2 Service running the container on port 8080.
  - CloudWatch log groups and stack outputs (`AlbDnsName`, `ClusterName`, `ServiceName`).
- **Parameters/context**:
  - Image: `-c ECR_IMAGE_URI=...` or env `ECR_IMAGE_URI`. When empty, the app derives it from account/region/repo/tag.
  - Desired count: `-c SERVICE_DESIRED_COUNT=2` or env `SERVICE_DESIRED_COUNT`.

Manual commands:
```bash
cd infra/cdk
mvn -q -e -DskipTests package
export CDK_DEFAULT_ACCOUNT=123456789012
export CDK_DEFAULT_REGION=us-east-1
ECR_IMAGE_URI=123456789012.dkr.ecr.us-east-1.amazonaws.com/core-spring-service:dev-abc123 \
  cdk deploy CoreServiceStack-regression --require-approval never
# After testing:
cdk destroy CoreServiceStack-regression --force
```

## Workflow highlights

1. Build Spring Boot JAR → Docker image.
2. Push image to Amazon ECR (tagged with branch + commit SHA or custom tag).
3. Deploy regression stack via CDK using the pushed image.
4. Wait, run smoke tests (`/actuator/health`), and collect CloudWatch metrics/logs.
5. Optionally promote the same image/tag to production and destroy the temporary regression stack.

Extend the blueprint with linting, integration tests, chaos exercises, or manual approvals to suit your release process.
