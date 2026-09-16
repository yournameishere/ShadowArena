import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";

export * from "./managed/shadowarena/contract/index.js";
export * from "./witnesses";

import * as CompiledShadowArenaContract from "./managed/shadowarena/contract/index.js";
import * as Witnesses from "./witnesses";

export const ShadowArenaContract = CompiledContract.make<
  CompiledShadowArenaContract.Contract<Witnesses.ShadowArenaPrivateState>
>(
  "ShadowArena",
  CompiledShadowArenaContract.Contract<Witnesses.ShadowArenaPrivateState>,
).pipe(
  CompiledContract.withWitnesses(Witnesses.witnesses),
  CompiledContract.withCompiledFileAssets("./managed/shadowarena"),
);
