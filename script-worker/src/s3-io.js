// Tiny S3 wrapper. The function-level S3 client is reused across warm
// invocations (Lambda freezes between calls but keeps top-level state).

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');

const REGION = process.env.AWS_REGION || 'us-east-1';
const s3 = new S3Client({ region: REGION });

async function downloadToFile(bucket, key, destPath) {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(res.Body, fs.createWriteStream(destPath));
}

async function uploadJson(bucket, key, obj) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(obj),
    ContentType: 'application/json',
  }));
}

async function uploadFile(bucket, key, path, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(path),
    ContentType: contentType || 'application/octet-stream',
  }));
}

module.exports = { downloadToFile, uploadJson, uploadFile };
