import { toast } from "react-toastify";

const baseOptions = {
  position: "top-right",
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
  theme: "colored",
};

export const notifySuccess = (message) =>
  toast.success(message || "Done.", { ...baseOptions, autoClose: 3000 });

export const notifyError = (message) =>
  toast.error(message || "Something went wrong. Please try again.", {
    ...baseOptions,
    autoClose: 5000,
  });

export const notifyInfo = (message) =>
  toast.info(message || "", { ...baseOptions, autoClose: 3500 });

export const notifyWarning = (message) =>
  toast.warn(message || "", { ...baseOptions, autoClose: 4000 });

export const errorMessage = (error, fallback = "Something went wrong.") =>
  error?.response?.data?.message || error?.message || fallback;

export default {
  success: notifySuccess,
  error: notifyError,
  info: notifyInfo,
  warn: notifyWarning,
};
