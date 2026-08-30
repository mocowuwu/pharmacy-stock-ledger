"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createUser,
  resetUserPassword,
  revokeUserSessions,
  setUserStatus,
  updateUser,
  UserError,
} from "@/lib/dal/users";
import { PermissionError } from "@/lib/dal/session";

function codeFor(error: unknown): string {
  if (error instanceof PermissionError) return "not_allowed";
  if (error instanceof UserError) return error.code;
  console.error(error);
  return "unknown";
}

function readProfile(formData: FormData) {
  return {
    fullName: String(formData.get("fullName") ?? "").trim(),
    locale: formData.get("locale") === "en" ? ("en" as const) : ("id" as const),
    isPharmacist: formData.get("isPharmacist") === "on",
    sipaNumber: String(formData.get("sipaNumber") ?? "").trim() || null,
    straNumber: String(formData.get("straNumber") ?? "").trim() || null,
    permissions: formData.getAll("permissions").map(String),
  };
}

function readEditableProfile(formData: FormData) {
  return { username: String(formData.get("username") ?? ""), ...readProfile(formData) };
}

export type NewUserState = {
  formError?: string;
  /**
   * Shown once and then gone. Held in the action's return value rather than in
   * the URL or the database: a temporary password in a query string would sit
   * in browser history and in any proxy log between here and the counter.
   */
  issued?: { username: string; fullName: string; password: string };
};

export async function submitNewUser(
  _prev: NewUserState,
  formData: FormData,
): Promise<NewUserState> {
  const profile = readProfile(formData);
  const username = String(formData.get("username") ?? "");

  try {
    const result = await createUser({ username, ...profile });
    revalidatePath("/users");
    return {
      issued: {
        username: result.username,
        fullName: profile.fullName,
        password: result.temporaryPassword,
      },
    };
  } catch (error) {
    return { formError: codeFor(error) };
  }
}

export type EditUserState = {
  formError?: string;
  saved?: boolean;
  issued?: { username: string; fullName: string; password: string };
  revoked?: number;
};

export async function submitEditUser(
  _prev: EditUserState,
  formData: FormData,
): Promise<EditUserState> {
  const id = String(formData.get("userId") ?? "");
  try {
    await updateUser(id, readEditableProfile(formData));
    revalidatePath("/users");
    revalidatePath(`/users/${id}`);
    return { saved: true };
  } catch (error) {
    return { formError: codeFor(error) };
  }
}

export async function issueNewPassword(
  _prev: EditUserState,
  formData: FormData,
): Promise<EditUserState> {
  const id = String(formData.get("userId") ?? "");
  const fullName = String(formData.get("fullName") ?? "");

  try {
    const result = await resetUserPassword(id);
    revalidatePath(`/users/${id}`);
    return {
      issued: { username: result.username, fullName, password: result.temporaryPassword },
    };
  } catch (error) {
    return { formError: codeFor(error) };
  }
}

export async function changeStatus(formData: FormData) {
  const id = String(formData.get("userId") ?? "");
  const status = formData.get("status") === "suspended" ? "suspended" : "active";

  try {
    await setUserStatus(id, status);
  } catch (error) {
    redirect(`/users/${id}?error=${codeFor(error)}`);
  }

  revalidatePath("/users");
  redirect(`/users/${id}?status=${status}`);
}

export async function signOutEverywhere(formData: FormData) {
  const id = String(formData.get("userId") ?? "");

  let revoked = 0;
  try {
    revoked = (await revokeUserSessions(id)).revoked;
  } catch (error) {
    redirect(`/users/${id}?error=${codeFor(error)}`);
  }

  revalidatePath(`/users/${id}`);
  redirect(`/users/${id}?revoked=${revoked}`);
}
