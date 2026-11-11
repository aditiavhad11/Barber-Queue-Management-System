import crypto from "node:crypto";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { deleteUploadedImage, uploadImage } from "../config/cloudinary.js";
import { pool } from "../config/db.js";

const EXTENSION_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_FOLDER = "barber-queue/shops";
const isAllowedFolder = (folder) =>
  folder === "barber-queue/barbers" ||
  folder === "barber-queue/shops" ||
  folder.startsWith("barber-queue/shops/");

export function safeImageFilename(extension) {
  return `${crypto.randomUUID()}${extension}`;
}

export async function validateImageFile(file) {
  if (
    !Buffer.isBuffer(file.buffer) ||
    !file.buffer.length ||
    file.buffer.length > MAX_BYTES
  )
    throw new Error("Image must be non-empty and no larger than 5 MB.");

  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  const expectedMime = EXTENSION_TYPES.get(extension);
  const detected = await fileTypeFromBuffer(file.buffer);
  if (
    !expectedMime ||
    !detected ||
    detected.mime !== expectedMime ||
    String(file.mimetype || "").toLowerCase() !== expectedMime
  ) {
    throw new Error("Only valid JPG, PNG and WebP image files are allowed.");
  }
  return { extension, mime: detected.mime };
}

export async function uploadValidatedImages(
  files,
  validatedFiles,
  folders,
  { upload = uploadImage, destroy = deleteUploadedImage } = {},
) {
  const images = [];
  const uploadedPublicIds = [];
  try {
    for (let i = 0; i < files.length; i += 1) {
      const filename = safeImageFilename(validatedFiles[i].extension);
      const result = await upload(files[i].buffer, folders[i], filename);
      uploadedPublicIds.push(result.public_id);
      images.push({
        id: result.public_id,
        url: result.secure_url,
        name: filename,
        type: validatedFiles[i].mime,
      });
    }
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      uploadedPublicIds.map((publicId) => destroy(publicId)),
    );
    const cleanupFailures = cleanupResults.filter(
      (result) => result.status === "rejected",
    );
    if (cleanupFailures.length) {
      console.error("Could not clean up all partial image uploads:", {
        uploadCount: uploadedPublicIds.length,
        cleanupFailures: cleanupFailures.length,
      });
    }
    throw error;
  }
  return images;
}

export async function uploadImages(req, res) {
  const files = req.files || [];
  if (!files.length)
    return res.status(400).json({ message: "At least one image is required." });

  const folders = Array.isArray(req.body.folders)
    ? req.body.folders
    : [req.body.folders];
  let validatedFiles;
  try {
    validatedFiles = await Promise.all(files.map(validateImageFile));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const uploadFolders = [];
  for (let i = 0; i < files.length; i += 1) {
    const requestedFolder = String(folders[i] || "");
    const folder = isAllowedFolder(requestedFolder)
      ? requestedFolder
      : DEFAULT_FOLDER;
    const shopFolder = /^barber-queue\/shops\/([^/]+)/.exec(folder);
    if (shopFolder) {
      let association;
      if (req.user?.role === "owner") {
        [association] = await pool.query(
          "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
          [shopFolder[1], req.user.sub],
        );
      } else if (req.user?.role === "shop") {
        [association] = await pool.query(
          "SELECT id FROM shops WHERE id=? AND id=? LIMIT 1",
          [shopFolder[1], req.user.shopId || req.user.sub],
        );
      } else if (req.user?.role === "co_owner") {
        [association] = await pool.query(
          `SELECT s.id FROM shops s
           JOIN shop_co_owners c ON c.shop_id=s.id AND c.id=? AND c.status='active'
           WHERE s.id=? LIMIT 1`,
          [req.user.sub, shopFolder[1]],
        );
      } else {
        association = [];
      }
      if (!association.length)
        return res.status(403).json({ message: "Shop upload is not authorized." });
    }
    const schemeFolder = /^barber-queue\/shops\/([^/]+)\/schemes$/.exec(folder);
    if (schemeFolder) {
      if (req.user?.role !== "owner")
        return res.status(403).json({ message: "Only the shop owner can upload scheme images." });
      const [owned] = await pool.query(
        "SELECT id FROM shops WHERE id=? AND owner_id=? LIMIT 1",
        [schemeFolder[1], req.user.sub],
      );
      if (!owned.length)
        return res.status(404).json({ message: "Shop not found or not owned by this account." });
    }
    uploadFolders.push(folder);
  }

  const images = await uploadValidatedImages(files, validatedFiles, uploadFolders);

  res.json({ images });
}
