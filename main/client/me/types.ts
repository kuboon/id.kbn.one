/**
 * Shared types for the `/me` account page and its feature cards.
 */

export type AlertKind = "info" | "success" | "warning" | "error";

/** Publishes a toast on the page. Owned by the top-level `Me` component. */
export type SetStatus = (
  message: string,
  kind?: AlertKind,
  autoHide?: boolean,
) => void;

export interface User {
  id: string;
  nickname: string;
}

export interface Credential {
  id: string;
  nickname: string;
  createdAt: number;
  updatedAt: number;
}

export interface Account {
  user: User;
  credentials: Credential[];
}
