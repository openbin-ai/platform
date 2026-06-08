# syntax=docker/dockerfile:1.7
#
# shell-worker — AWS Lambda container image, JS-3 sibling of script-worker
# and pypi-worker. Statically analyzes loose PowerShell / bash / sh scripts
# (and zip / tar.gz archives containing them) for malicious-dropper
# patterns. Regex-only — bash and PowerShell don't have a clean stdlib AST
# in Python, and the patterns of interest (curl|sh, IEX(DownloadString),
# base64 -d | sh) are exactly what regex catches well.

FROM public.ecr.aws/lambda/python:3.12

WORKDIR ${LAMBDA_TASK_ROOT}

COPY src/ ./

CMD ["handler.handler"]
