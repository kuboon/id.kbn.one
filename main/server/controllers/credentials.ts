/**
 * /credentials/* — list, rename, and delete the signed-in user's passkeys.
 */

import type { RequestContext } from "@remix-run/fetch-router";
import { type } from "arktype";

import { setNoStore } from "../middleware/auth.ts";
import { User } from "../middleware/user.ts";
import { credentialRepository } from "../repositories.ts";

const credentialIdParam = type({ credentialId: "string" });
const updateNicknameBody = type({ nickname: "string>0" });

export const credentialsController = {
  actions: {
    async list(context: RequestContext) {
      const { id: userId } = context.get(User);
      const credentials = await credentialRepository.getCredentialsByUserId(
        userId,
      );
      return setNoStore(Response.json({ userId, credentials }));
    },

    async update(context: RequestContext) {
      const { id: userId } = context.get(User);
      const param = credentialIdParam(context.params);
      if (param instanceof type.errors) {
        return Response.json({ message: param.summary }, { status: 400 });
      }
      let raw: unknown;
      try {
        raw = await context.request.json();
      } catch {
        return Response.json({ message: "Invalid JSON body" }, { status: 400 });
      }
      const body = updateNicknameBody(raw);
      if (body instanceof type.errors) {
        return Response.json({ message: body.summary }, { status: 400 });
      }
      const credential = await credentialRepository.getCredentialById(
        param.credentialId,
      );
      if (!credential || credential.userId !== userId) {
        return Response.json({ message: "Credential not found" }, {
          status: 404,
        });
      }
      if (credential.nickname !== body.nickname) {
        credential.nickname = body.nickname;
        credential.updatedAt = Date.now();
        await credentialRepository.updateCredential(credential);
      }
      return setNoStore(Response.json({ credential }));
    },

    async delete(context: RequestContext) {
      const { id: userId } = context.get(User);
      const param = credentialIdParam(context.params);
      if (param instanceof type.errors) {
        return Response.json({ message: param.summary }, { status: 400 });
      }
      const credential = await credentialRepository.getCredentialById(
        param.credentialId,
      );
      if (!credential || credential.userId !== userId) {
        return Response.json({ message: "Credential not found" }, {
          status: 404,
        });
      }
      await credentialRepository.deleteCredential(param.credentialId);
      return setNoStore(Response.json({ success: true }));
    },
  },
};
