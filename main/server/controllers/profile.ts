/**
 * PATCH /profile — update the signed-in user's display nickname.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { type } from "arktype";

import { setNoStore } from "../middleware/auth.ts";
import { User } from "../middleware/user.ts";
import { NICKNAME_MAX_LENGTH, setUserNickname } from "../lib/user-profile.ts";

const updateProfileBody = type({ nickname: "string" });

export const profileUpdateAction = async (
  context: RequestContext,
): Promise<Response> => {
  const { id: userId } = context.get(User);
  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return Response.json({ message: "Invalid JSON body" }, { status: 400 });
  }
  const body = updateProfileBody(raw);
  if (body instanceof type.errors) {
    return Response.json({ message: body.summary }, { status: 400 });
  }
  const nickname = body.nickname.trim();
  if (!nickname) {
    return Response.json({ message: "ユーザー名を入力してください。" }, {
      status: 400,
    });
  }
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return Response.json({
      message: `ユーザー名は${NICKNAME_MAX_LENGTH}文字以内で入力してください。`,
    }, { status: 400 });
  }
  const profile = await setUserNickname(userId, nickname);
  return setNoStore(Response.json({ profile }));
};
