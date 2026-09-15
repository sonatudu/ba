import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const endpoint = process.env.OCI_ENDPOINT;
const region = process.env.OCI_REGION || "ap-hyderabad-1";
const bucket = process.env.OCI_BUCKET_NAME;
const accessKeyId = process.env.OCI_ACCESS_KEY;
const secretAccessKey = process.env.OCI_SECRET_KEY;

export const isOciConfigured = Boolean(
  endpoint && bucket && accessKeyId && secretAccessKey
);

export const s3 = isOciConfigured
  ? new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Required for OCI Object Storage compatibility
    })
  : null;

// Upload a single file/buffer to OCI
export async function uploadToOci(key, data, contentType = "application/json") {
  if (!isOciConfigured) return;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );
  } catch (err) {
    console.error(`[oci] failed to upload ${key}:`, err.message);
  }
}

// Download a single file from OCI as a Buffer
export async function getFromOci(key) {
  if (!isOciConfigured) return null;
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    const byteArray = await res.Body.transformToByteArray();
    return Buffer.from(byteArray);
  } catch (err) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.error(`[oci] failed to get ${key}:`, err.message);
    return null;
  }
}

// Sync all existing objects from the bucket to the local directory at server boot
export async function syncFromOciToDisk(localDataDir, fsPromises) {
  if (!isOciConfigured) {
    console.log("[oci] storage not configured, using local disk only");
    return;
  }
  console.log("[oci] syncing storage from OCI bucket...");
  try {
    const listRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
      })
    );

    if (!listRes.Contents || listRes.Contents.length === 0) {
      console.log("[oci] bucket is empty, starting fresh");
      return;
    }

    const path = await import("path");

    for (const item of listRes.Contents) {
      const remoteKey = item.Key;
      const localFilePath = path.join(localDataDir, remoteKey);
      const dirName = path.dirname(localFilePath);

      await fsPromises.mkdir(dirName, { recursive: true });
      const data = await getFromOci(remoteKey);
      if (data) {
        await fsPromises.writeFile(localFilePath, data);
      }
    }
    console.log(`[oci] successfully synced ${listRes.Contents.length} files from OCI`);
  } catch (err) {
    console.error("[oci] sync failed:", err.message);
  }
}
