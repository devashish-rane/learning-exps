#!/usr/bin/env bash
set -euo pipefail

# Regression pipeline helper. Requires AWS CLI, CDK, Docker, Maven.
# Usage:
#   ./scripts/regression.sh \
#     --aws-account 123456789012 \
#     --aws-region us-east-1 \
#     --image-tag dev-$(git rev-parse --short HEAD)

AWS_ACCOUNT=""
AWS_REGION="us-east-1"
IMAGE_TAG="dev"
APP_NAME="core-spring-service"
ECR_REPO=""
STACK_REG=""

usage() {
  cat <<'EOF'
Usage: regression.sh --aws-account <id> --aws-region <region> --image-tag <tag>

Runs build -> push -> CDK deploy (regression) -> sanity test -> destroy.
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --aws-account)
      AWS_ACCOUNT="$2"; shift 2;;
    --aws-region)
      AWS_REGION="$2"; shift 2;;
    --image-tag)
      IMAGE_TAG="$2"; shift 2;;
    *) usage;;
  esac
done

[[ -n "$AWS_ACCOUNT" ]] || usage
ECR_REPO="$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$APP_NAME"
STACK_PURPOSE="reg-${IMAGE_TAG}"
STACK_REG="CoreServiceStack-${STACK_PURPOSE}"

echo "[1/6] Building JAR"
pushd ../core-spring-service >/dev/null
./mvnw -B -DskipTests package
popd >/dev/null

echo "[2/6] Building Docker image"
docker build -t $APP_NAME:$IMAGE_TAG ../core-spring-service

echo "[3/6] Login + push to ECR"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REPO"
docker tag $APP_NAME:$IMAGE_TAG $ECR_REPO:$IMAGE_TAG
docker push $ECR_REPO:$IMAGE_TAG

echo "[4/6] Deploying regression stack $STACK_REG"
pushd ../cdk >/dev/null
mvn -q -e -DskipTests package
export CDK_DEFAULT_ACCOUNT="$AWS_ACCOUNT"
export CDK_DEFAULT_REGION="$AWS_REGION"
STACK_PURPOSE="$STACK_PURPOSE" ECR_IMAGE_URI="$ECR_REPO:$IMAGE_TAG" cdk deploy "$STACK_REG" --require-approval never
popd >/dev/null

echo "[5/6] Smoke testing"
ALB_DNS=$(aws cloudformation describe-stacks --stack-name "$STACK_REG" \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" --output text)
curl -f "http://$ALB_DNS/actuator/health"

echo "[6/6] Destroy regression stack"
pushd ../cdk >/dev/null
cdk destroy "$STACK_REG" --force
popd >/dev/null

echo "Done."
