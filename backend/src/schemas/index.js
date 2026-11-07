import { z } from "zod";
import { PATTERNS } from "../utils/validators.js";

// Reusable primitives based on established PATTERNS
export const emailSchema = z
  .string({ required_error: "Email is required." })
  .trim()
  .regex(PATTERNS.EMAIL, "Enter a valid email address.");

export const phoneSchema = z
  .string({ required_error: "Phone number is required." })
  .trim()
  .regex(PATTERNS.PHONE, "Enter a valid 10-digit mobile number.");

export const otpSchema = z
  .string({ required_error: "OTP code is required." })
  .trim()
  .regex(PATTERNS.OTP, "Enter a valid 6-digit OTP.");

export const dateSchema = z
  .string({ required_error: "Date is required." })
  .trim()
  .regex(PATTERNS.DATE, "Select a valid date in YYYY-MM-DD format.");

export const timeSchema = z
  .string({ required_error: "Time is required." })
  .trim()
  .regex(PATTERNS.TIME, "Select a valid time in HH:MM format.");

export const ratingSchema = z.coerce
  .number({ invalid_type_error: "Choose a rating from 1 to 5." })
  .int("Rating must be an integer.")
  .min(1, "Choose a rating from 1 to 5.")
  .max(5, "Choose a rating from 1 to 5.");

export const upiIdSchema = z
  .string({ required_error: "UPI ID is required." })
  .trim()
  .regex(PATTERNS.UPI_ID, "Enter a valid UPI ID (e.g. name@bank).");

// ---------------------------------------------------------------------------
// Auth Schemas
// ---------------------------------------------------------------------------

export const requestOtpSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().max(60).optional(),
  role: z.enum(["owner", "customer"]).optional(),
});

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  code: otpSchema,
});

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export const shopLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

// ---------------------------------------------------------------------------
// Review Schemas
// ---------------------------------------------------------------------------

export const createReviewSchema = z.object({
  shopId: z.string().min(1, "Shop ID is required."),
  queueId: z.string().min(1, "Queue ID is required."),
  rating: ratingSchema,
  text: z.string().trim().max(2000).optional().default(""),
});

// ---------------------------------------------------------------------------
// Complaint Schemas
// ---------------------------------------------------------------------------

export const createComplaintSchema = z
  .object({
    shopId: z.string().min(1, "Shop is required."),
    targetType: z.enum(["staff", "owner"], {
      errorMap: () => ({
        message: "Choose whether the complaint is about staff or the shop owner.",
      }),
    }),
    targetBarberId: z.string().nullable().optional(),
    issueType: z.string().trim().max(80).optional().default("Other"),
    subject: z
      .string()
      .trim()
      .min(3, "Subject must be between 3 and 190 characters.")
      .max(190, "Subject must be between 3 and 190 characters.")
      .regex(/^[\w\s.,?!'"()\-]{3,190}$/, "Subject must be between 3 and 190 characters."),
    description: z
      .string()
      .trim()
      .min(5, "Description must be at least 5 characters long.")
      .max(5000, "Description must be up to 5000 characters."),
  })
  .refine(
    (data) => (data.targetType === "staff") === Boolean(data.targetBarberId),
    {
      message: "Choose a staff member for staff complaints only.",
      path: ["targetBarberId"],
    },
  );

export const updateComplaintStatusSchema = z.object({
  status: z.enum(["open", "investigating", "resolved", "closed"], {
    errorMap: () => ({ message: "Choose a valid complaint status." }),
  }),
});

// ---------------------------------------------------------------------------
// Booking & Payment Schemas
// ---------------------------------------------------------------------------

export const paymentQuoteSchema = z.object({
  shopId: z.string().min(1, "Shop ID is required."),
  barberId: z.string().min(1, "Barber ID is required."),
  serviceIds: z.array(z.string()).min(1, "Select at least one service."),
  bookingDate: dateSchema,
  scheduledTime: timeSchema.nullable().optional(),
  promoCode: z.string().trim().optional(),
  bogoOfferId: z.string().optional(),
  serviceQuantities: z.record(z.coerce.number()).optional(),
  rewardServiceQuantities: z.record(z.coerce.number()).optional(),
  beneficiary: z.any().optional(),
});

export const saveUpiSettingsSchema = z.object({
  shopId: z.string().min(1, "Shop ID is required."),
  upiId: upiIdSchema,
  upiName: z.string().trim().max(100).optional(),
});
