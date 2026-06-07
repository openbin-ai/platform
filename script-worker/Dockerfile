# syntax=docker/dockerfile:1.7
#
# script-worker — AWS Lambda container image. Node 22 base ships with the
# Lambda Runtime Interface Client already wired; the CMD just names the
# handler export. Built for sporadic, bounded malicious-NPM scans.
#
# Locally testable with the Lambda Runtime Interface Emulator (RIE),
# which is baked into the AWS base image — see README.md.

FROM public.ecr.aws/lambda/nodejs:22

# /var/task is the read-only code dir Lambda expects.
WORKDIR ${LAMBDA_TASK_ROOT}

# Install deps first for layer caching. We use `npm ci` against a committed
# package-lock.json so the image is bit-reproducible for any given commit.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src/ ./src/

# Lambda picks up the handler via CMD. Format: "<file>.<exported-function>"
# (no .js extension on the file part).
CMD ["src/handler.handler"]
