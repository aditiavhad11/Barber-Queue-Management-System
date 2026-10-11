import { v2 as cloudinary } from "cloudinary";

const required = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

function configureCloudinary() {
  const missing = required.filter(
    (name) => !String(process.env[name] || "").trim(),
  );

  if (missing.length) {
    const error = new Error(
      `Cloudinary is not configured. Missing backend environment variable(s): ${missing.join(", ")}.`,
    );
    error.status = 503;
    throw error;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME.trim(),
    api_key: process.env.CLOUDINARY_API_KEY.trim(),
    api_secret: process.env.CLOUDINARY_API_SECRET.trim(),
    secure: true,
  });

  return cloudinary;
}

export function uploadImage(buffer, folder) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return Promise.reject(new Error("Invalid or empty image buffer."));
  }

  if (typeof folder !== "string" || !folder.trim()) {
    return Promise.reject(new Error("A valid Cloudinary folder is required."));
  }

  const client = configureCloudinary();

  return new Promise((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        folder: folder.trim(),
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        if (!result) {
          return reject(new Error("Cloudinary returned no upload result."));
        }

        resolve(result);
      },
    );

    stream.on("error", reject);
    stream.end(buffer);
  });
}
