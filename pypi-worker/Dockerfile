# syntax=docker/dockerfile:1.7
#
# pypi-worker — AWS Lambda container image, JS-2 sibling of script-worker.
# Python 3.12 base ships with the Lambda Runtime Interface Client already
# wired; the CMD just names the handler export.
#
# Only stdlib + boto3 (preinstalled in the base image) — the AST analyzer
# uses Python's own `ast` module, so there are no extra wheels to build.

FROM public.ecr.aws/lambda/python:3.12

WORKDIR ${LAMBDA_TASK_ROOT}

COPY src/ ./

# "<module>.<function>" — module is `handler.py`, function is `handler`.
CMD ["handler.handler"]
