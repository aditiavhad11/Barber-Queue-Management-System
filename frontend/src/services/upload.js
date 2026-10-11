import { api } from "./api";

export const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const MAX_MB = 5;

export async function uploadImage(file, folder = "barber-queue/shops") {
  const [image] = await uploadImages([{ file, folder }], api);
  return image;
}

export async function uploadImages(items, api) {
  if (!items.length) return [];
  const formData = new FormData();
  items.forEach(({ file, folder }) => {
    formData.append("images", file);
    formData.append("folders", folder);
  });
  const { data } = await api.post("/uploads/images", formData);
  return data.images;
}
