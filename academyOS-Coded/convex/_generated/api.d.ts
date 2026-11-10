/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as academy from "../academy.js";
import type * as assessments from "../assessments.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as batches from "../batches.js";
import type * as chatbot from "../chatbot.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as inquiries from "../inquiries.js";
import type * as lateFines from "../lateFines.js";
import type * as ledger from "../ledger.js";
import type * as lib_ai from "../lib/ai.js";
import type * as lib_authz from "../lib/authz.js";
import type * as lib_resendOtp from "../lib/resendOtp.js";
import type * as model_chatbot from "../model/chatbot.js";
import type * as model_chatbotAi from "../model/chatbotAi.js";
import type * as model_email from "../model/email.js";
import type * as model_ledger from "../model/ledger.js";
import type * as model_remarks from "../model/remarks.js";
import type * as model_remarksAi from "../model/remarksAi.js";
import type * as model_reminders from "../model/reminders.js";
import type * as model_remindersAi from "../model/remindersAi.js";
import type * as model_roster from "../model/roster.js";
import type * as model_vouchers from "../model/vouchers.js";
import type * as remarks from "../remarks.js";
import type * as reminders from "../reminders.js";
import type * as resetDemo from "../resetDemo.js";
import type * as seed from "../seed.js";
import type * as seedDemo from "../seedDemo.js";
import type * as staff from "../staff.js";
import type * as stripe from "../stripe.js";
import type * as stripeWebhook from "../stripeWebhook.js";
import type * as students from "../students.js";
import type * as vouchers from "../vouchers.js";
import type * as waitlist from "../waitlist.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  academy: typeof academy;
  assessments: typeof assessments;
  attendance: typeof attendance;
  auth: typeof auth;
  batches: typeof batches;
  chatbot: typeof chatbot;
  crons: typeof crons;
  files: typeof files;
  http: typeof http;
  inquiries: typeof inquiries;
  lateFines: typeof lateFines;
  ledger: typeof ledger;
  "lib/ai": typeof lib_ai;
  "lib/authz": typeof lib_authz;
  "lib/resendOtp": typeof lib_resendOtp;
  "model/chatbot": typeof model_chatbot;
  "model/chatbotAi": typeof model_chatbotAi;
  "model/email": typeof model_email;
  "model/ledger": typeof model_ledger;
  "model/remarks": typeof model_remarks;
  "model/remarksAi": typeof model_remarksAi;
  "model/reminders": typeof model_reminders;
  "model/remindersAi": typeof model_remindersAi;
  "model/roster": typeof model_roster;
  "model/vouchers": typeof model_vouchers;
  remarks: typeof remarks;
  reminders: typeof reminders;
  resetDemo: typeof resetDemo;
  seed: typeof seed;
  seedDemo: typeof seedDemo;
  staff: typeof staff;
  stripe: typeof stripe;
  stripeWebhook: typeof stripeWebhook;
  students: typeof students;
  vouchers: typeof vouchers;
  waitlist: typeof waitlist;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
