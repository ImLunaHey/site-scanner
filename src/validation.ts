import { z } from "zod";

export const headerSchema = z.object({
  "strict-transport-security": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        /^max-age=\d+; includeSubDomains$/.test(value)
      ),
      {
        message:
          "Invalid 'Strict-Transport-Security' header format. It should be in the format 'max-age=number; includeSubDomains'.",
      }
    ),
  "content-security-policy": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        value.toLowerCase().includes("default-src") ||
        value.toLowerCase().includes("script-src")
      ),
      {
        message:
          "Invalid 'Content-Security-Policy' header value. It should include 'default-src' or 'script-src' directives.",
      }
    ),
  "x-frame-options": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        /^SAMEORIGIN$/.test(value) ||
        /^DENY$/.test(value)
      ),
      {
        message:
          "Invalid 'X-Frame-Options' header value. It should be 'SAMEORIGIN' or 'DENY'.",
      }
    ),
  "x-content-type-options": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        /^nosniff$/.test(value)
      ),
      {
        message:
          "Invalid 'X-Content-Type-Options' header value. It should be 'nosniff'.",
      }
    ),
  "referrer-policy": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        [
          "no-referrer",
          "no-referrer-when-downgrade",
          "same-origin",
          "origin",
          "strict-origin",
          "origin-when-cross-origin",
          "strict-origin-when-cross-origin",
          "unsafe-url",
        ].includes(value.toLowerCase())
      ),
      {
        message:
          "Invalid 'Referrer-Policy' header value. It should be one of the allowed values.",
      }
    ),
  "permissions-policy": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        value.toLowerCase().includes("geolocation") ||
        value.toLowerCase().includes("notifications") ||
        value.toLowerCase().includes("camera") ||
        value.toLowerCase().includes("microphone")
      ),
      {
        message:
          "Invalid 'Permissions-Policy' header value. It should include at least one of the specified features (geolocation, notifications, camera, microphone).",
      }
    ),
  "content-security-policy-report-only": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        value.toLowerCase().includes("default-src") ||
        value.toLowerCase().includes("script-src")
      ),
      {
        message:
          "Invalid 'Content-Security-Policy-Report-Only' header value. It should include 'default-src' or 'script-src' directives.",
      }
    ),
  "x-xss-protection": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        /^1$/.test(value) ||
        /^0$/.test(value)
      ),
      {
        message:
          "Invalid 'X-XSS-Protection' header value. It should be '1' to enable or '0' to disable.",
      }
    ),
  "expect-ct": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        value.toLowerCase().includes("max-age") &&
        value.toLowerCase().includes("enforce") &&
        value.toLowerCase().includes("report-uri")
      ),
      {
        message:
          "Invalid 'Expect-CT' header value. It should include 'max-age', 'enforce', and 'report-uri' directives.",
      }
    ),
  "feature-policy": z.string().optional(), // Customize validation based on specific features
  "public-key-pins": z.string().optional(), // Customize validation based on your PKP policy
  "content-encoding": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        /^(gzip|deflate)$/.test(value)
      ),
      {
        message:
          "Invalid 'Content-Encoding' header value. It should be 'gzip' or 'deflate' for compression.",
      }
    ),
  "strict-transport-security-preload": z
    .string()
    .optional()
    .refine(
      (value) => !value || (
        value.toLowerCase() === "preload"
      ),
      {
        message:
          "Invalid 'Strict-Transport-Security-Preload' header value. It should be 'preload'.",
      }
    ),
  "access-control-allow-origin": z.string().optional(), // Customize validation based on your CORS policy
  "server": z
    .string()
    .refine(
      (value) =>
        !value.toLowerCase().includes("cloudflare") &&
        !value.toLowerCase().includes("apache") &&
        !value.toLowerCase().includes("caddy") &&
        !value.toLowerCase().includes("iis"),
      {
        message:
          "Invalid 'Server' header value. It should not reveal server-specific information like 'Apache', 'Caddy', or 'IIS'.",
      }
    ),
});

export type HeaderObject = z.infer<typeof headerSchema>;
