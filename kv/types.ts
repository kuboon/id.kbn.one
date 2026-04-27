export type KvKeyPart = string | number | bigint | boolean;
export type KvKey = KvKeyPart[];

export type KvOptions = {
  expireIn?: number;
};

export type KvUpdateResult = {
  ok: boolean;
};

export interface KvEntryInterface<TVal, TKeyPart, TKvOptions = KvOptions> {
  key: TKeyPart;
  fullKey: TKeyPart[];
  get(): Promise<TVal | null>;
  update(
    updater: (current: TVal | null) => TVal | null,
    opts?: TKvOptions,
  ): Promise<KvUpdateResult>;
}

export interface KvRepo<
  TVal = string,
  TKeyPart = KvKeyPart,
  TKvOptions = KvOptions,
> extends AsyncIterable<KvEntryInterface<TVal, TKeyPart, TKvOptions>> {
  prefix: TKeyPart[];
  genKey(): string;
  entry<TEntryVal = TVal>(
    key: TKeyPart,
  ): KvEntryInterface<TEntryVal, TKeyPart, TKvOptions>;
}
