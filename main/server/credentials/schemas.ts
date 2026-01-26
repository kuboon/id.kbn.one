import { type } from "arktype";

export const credentialIdParamSchema = type({
  credentialId: "string>0",
});

export const updateNicknameBodySchema = type({
  nickname: "string>0",
});

// Infer types from schemas
export type CredentialIdParam = typeof credentialIdParamSchema.infer;
export type UpdateNicknameBody = typeof updateNicknameBodySchema.infer;
