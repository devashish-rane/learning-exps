#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

usage() {
  local code="${1:-1}"
  cat <<'USAGE'
Usage: stack.sh [--debug] <command> [args]

Commands:
  up [--stack-purpose <name>] [--image-tag <tag>] [--service-count <n>]
      Deploy the CDK stack using values from .env (overridable via flags).

  down [--stack-purpose <name>]
      Destroy the CDK stack that matches the provided purpose.

  regression [--stack-purpose <name>] [--image-tag <tag>]
      Build -> push -> deploy -> smoke test -> destroy in one go.

Environment is always loaded from .env in the repository root.
Set DEBUG=1 or pass --debug to enable bash tracing.
USAGE
  exit "${code}"
}

if [[ $# -eq 0 ]]; then
  usage
fi

if [[ "${1:-}" == "--debug" ]]; then
  export DEBUG=1
  set -x
  shift
fi

if [[ $# -eq 0 ]]; then
  usage
fi

if [[ "${1:-}" =~ ^(--help|-h|help)$ ]]; then
  usage 0
fi

ensure_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Missing .env file at ${ENV_FILE}" >&2
    exit 1
  fi

  set -o allexport
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +o allexport

  unset AWS_PROFILE

  AWS_REGION="${AWS_REGION:-${CDK_DEFAULT_REGION:-}}"
  CDK_DEFAULT_REGION="${CDK_DEFAULT_REGION:-${AWS_REGION:-}}"
  AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-${CDK_DEFAULT_ACCOUNT:-}}"
  CDK_DEFAULT_ACCOUNT="${CDK_DEFAULT_ACCOUNT:-${AWS_ACCOUNT_ID:-}}"
  AWS_DEFAULT_REGION="${AWS_REGION:-}"

  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  export AWS_REGION AWS_DEFAULT_REGION CDK_DEFAULT_REGION
  export AWS_ACCOUNT_ID CDK_DEFAULT_ACCOUNT STACK_PURPOSE
  export ECR_REPOSITORY IMAGE_TAG ECR_IMAGE_URI SERVICE_DESIRED_COUNT

  if [[ -z "${AWS_ACCESS_KEY_ID:-}" || -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
    echo "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in .env" >&2
    exit 1
  fi

  if [[ -z "${AWS_REGION:-}" ]]; then
    echo "AWS_REGION (or CDK_DEFAULT_REGION) must be set in .env" >&2
    exit 1
  fi

  if [[ -z "${AWS_ACCOUNT_ID:-}" ]]; then
    echo "AWS_ACCOUNT_ID (or CDK_DEFAULT_ACCOUNT) must be set in .env" >&2
    exit 1
  fi
}

ensure_env

command="$1"
shift

STACK_PURPOSE="${STACK_PURPOSE:-regression}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
SERVICE_DESIRED_COUNT="${SERVICE_DESIRED_COUNT:-1}"
REMAINING_ARGS=()

parse_common_flags() {
  REMAINING_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --stack-purpose)
        STACK_PURPOSE="$2"; shift 2 ;;
      --image-tag)
        IMAGE_TAG="$2"; shift 2 ;;
      --service-count|--service-desired-count)
        SERVICE_DESIRED_COUNT="$2"; shift 2 ;;
      --help|-h)
        usage ;;
      --debug)
        set -x; DEBUG=1; shift ;;
      --*)
        echo "Unknown option: $1" >&2
        usage ;;
      *)
        REMAINING_ARGS+=("$1")
        shift ;;
    esac
  done
}

stack_name() {
  echo "CoreServiceStack-${STACK_PURPOSE}"
}

resolve_image_uri() {
  local registry="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  local repository_path="${registry}/${ECR_REPOSITORY:-core-spring-service}"
  if [[ -n "${ECR_IMAGE_URI:-}" ]]; then
    echo "${ECR_IMAGE_URI}"
  else
    echo "${repository_path}:${IMAGE_TAG:-latest}"
  fi
}

run_cdk() {
  local action="$1"; shift
  pushd "${PROJECT_ROOT}/infra/cdk" >/dev/null
  mvn -q -e -DskipTests package
  CDK_DEFAULT_ACCOUNT="${AWS_ACCOUNT_ID}" \
  CDK_DEFAULT_REGION="${AWS_REGION}" \
  "$action" "$@"
  popd >/dev/null
}

cmd_up() {
  parse_common_flags "$@"
  if (( ${#REMAINING_ARGS[@]} )); then
    echo "Unexpected arguments for up: ${REMAINING_ARGS[*]}" >&2
    usage
  fi
  local name="$(stack_name)"
  local image_uri="$(resolve_image_uri)"
  run_cdk cdk deploy "${name}" --require-approval never \
    -c STACK_PURPOSE="${STACK_PURPOSE}" \
    -c ECR_IMAGE_URI="${image_uri}" \
    -c SERVICE_DESIRED_COUNT="${SERVICE_DESIRED_COUNT}"
  echo "Stack ${name} deployed with image ${image_uri}."
}

cmd_down() {
  parse_common_flags "$@"
  if (( ${#REMAINING_ARGS[@]} )); then
    echo "Unexpected arguments for down: ${REMAINING_ARGS[*]}" >&2
    usage
  fi
  local name="$(stack_name)"
  run_cdk cdk destroy "${name}" --force
  echo "Stack ${name} destroyed."
}

cmd_regression() {
  parse_common_flags "$@"
  if (( ${#REMAINING_ARGS[@]} )); then
    echo "Unexpected arguments for regression: ${REMAINING_ARGS[*]}" >&2
    usage
  fi
  local name="$(stack_name)"
  local registry="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  local repository_path="${registry}/${ECR_REPOSITORY:-core-spring-service}"
  local image_uri="${ECR_IMAGE_URI:-${repository_path}:${IMAGE_TAG}}"

  if [[ -z "${IMAGE_TAG}" ]]; then
    echo "IMAGE_TAG must be provided (via .env or --image-tag)." >&2
    exit 1
  fi

  printf '[1/6] Building JAR\n'
  pushd "${PROJECT_ROOT}/core-spring-service" >/dev/null
  ./mvnw -B -DskipTests package
  popd >/dev/null

  printf '[2/6] Building Docker image\n'
  docker build -t "${ECR_REPOSITORY:-core-spring-service}:${IMAGE_TAG}" \
    "${PROJECT_ROOT}/core-spring-service"

  printf '[3/6] Login + push to ECR\n'
  aws ecr get-login-password --region "${AWS_REGION}" \
    | docker login --username AWS --password-stdin "${registry}"
  docker tag "${ECR_REPOSITORY:-core-spring-service}:${IMAGE_TAG}" "${image_uri}"
  docker push "${image_uri}"

  printf '[4/6] Deploying regression stack %s\n' "${name}"
  run_cdk cdk deploy "${name}" --require-approval never \
    -c STACK_PURPOSE="${STACK_PURPOSE}" \
    -c ECR_IMAGE_URI="${image_uri}" \
    -c SERVICE_DESIRED_COUNT="${SERVICE_DESIRED_COUNT}"

  printf '[5/6] Smoke testing\n'
  ALB_DNS=$(aws cloudformation describe-stacks --stack-name "${name}" \
    --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" --output text)
  curl -f "http://${ALB_DNS}/actuator/health"

  printf '[6/6] Destroy regression stack\n'
  run_cdk cdk destroy "${name}" --force

  printf 'Done.\n'
}

case "${command}" in
  up)
    cmd_up "$@" ;;
  down)
    cmd_down "$@" ;;
  regression)
    cmd_regression "$@" ;;
  --help|-h|help)
    usage ;;
  *)
    echo "Unknown command: ${command}" >&2
    usage ;;
esac
