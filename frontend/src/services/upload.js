const CLOUD_NAME = String(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || "").trim();
const UPLOAD_PRESET = String(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || "").trim();

export const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const MAX_MB = 5;

export async function uploadImage(file, folder = "barber-queue/shops") {
  if (!file) throw new Error("Please select an image.");
  if (!ACCEPTED.includes(file.type))
    throw new Error("Only JPG, PNG and WEBP images are allowed.");
  if (file.size > MAX_MB * 1024 * 1024)
    throw new Error(`Image must be smaller than ${MAX_MB}MB.`);
  if (
    !CLOUD_NAME ||
    !UPLOAD_PRESET ||
    CLOUD_NAME === "YOUR_CLOUD_NAME" ||
    /\s/.test(CLOUD_NAME)
  )
    throw new Error(
      "Cloudinary is not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in frontend/.env.",
    );

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);
  formData.append("folder", folder);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      body: formData,
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data?.error?.message || "Cloudinary image upload failed.");

  return {
    id: data.public_id,
    url: data.secure_url,
    primary: false,
    name: file.name,
    type: file.type,
  };
}
