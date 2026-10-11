import { uploadImage } from "../config/cloudinary.js";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_FOLDER = "barber-queue/shops";
const isAllowedFolder = (folder) =>
  folder === "barber-queue/barbers" ||
  folder === "barber-queue/shops" ||
  folder.startsWith("barber-queue/shops/");

export async function uploadImages(req, res) {
  const files = req.files || [];
  if (!files.length)
    return res.status(400).json({ message: "At least one image is required." });

  const folders = Array.isArray(req.body.folders)
    ? req.body.folders
    : [req.body.folders];
  const images = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!ACCEPTED_TYPES.has(file.mimetype))
      return res.status(400).json({
        message: `${file.originalname}: only JPG, PNG and WebP images are allowed.`,
      });
    if (file.size > MAX_BYTES)
      return res.status(400).json({
        message: `${file.originalname}: image must be smaller than 5 MB.`,
      });

    const requestedFolder = String(folders[i] || "");
    const folder = isAllowedFolder(requestedFolder)
      ? requestedFolder
      : DEFAULT_FOLDER;
    const result = await uploadImage(file.buffer, folder);
    images.push({
      id: result.public_id,
      url: result.secure_url,
      name: file.originalname,
      type: file.mimetype,
    });
  }

  res.json({ images });
}
