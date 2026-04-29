import { post } from "@remix-run/fetch-router/routes";

export default {
  registerOptions: post("/register/options"),
  registerVerify: post("/register/verify"),
  authenticateOptions: post("/authenticate/options"),
  authenticateVerify: post("/authenticate/verify"),
};
