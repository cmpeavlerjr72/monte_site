// src/lib/userSettings.ts
//
// THE SIZING SETTINGS, ON THE ACCOUNT — unit size, how a unit is spent, and
// the risk cap on the stretch modes. They moved off this browser and onto the
// user's profile (owner rule 2026-09-08) for one reason: the feed shows every
// bet in UNITS of the poster's own unit, so the server has to know what a unit
// IS, and a number that only exists in one browser's localStorage cannot be
// read by anything else.
//
// THREE RULES:
//
//  1. THE UNIT IS PRIVATE. `profiles.unit_size` is not granted to any client
//     role (supabase/migrations/20260908_units.sql). It is reachable ONLY
//     through the two SECURITY DEFINER RPCs called here, both of which act on
//     auth.uid() and take no user id — so this module cannot read anyone
//     else's settings even if it wanted to.
//  2. LOCALSTORAGE IS NOW A MIRROR, not the source. The scoreboard reads the
//     unit SYNCHRONOUSLY at mount (`readUnit`/`readSizing` in ownerPrefs) and
//     an RPC is not synchronous, so every read and write here also writes the
//     prefs. A signed-out visitor keeps the old per-browser behaviour exactly.
//  3. THE MIRROR LANDS ON THE NEXT MOUNT. A page already rendered keeps the
//     value it started with until it re-mounts (a navigation or a reload).
//     That is the honest limit of mirroring into a synchronous read, and it is
//     why the dashboard says the settings are what the scoreboard sizes with —
//     not that a change reaches an open board mid-session.

import { supabase } from "./supabase";
import {
  clampUnit, readMaxRiskMultiple, readUnitMode, readUnit,
  writeMaxRiskMultiple, writeUnit, writeUnitMode,
} from "./ownerPrefs";
import { clampRiskMultiple, type UnitMode } from "./suggestedBets";

export type UserSettings = { unit: number; mode: UnitMode; multiple: number };

const modeOf = (v: unknown): UnitMode =>
  v === "to-win" || v === "book" ? v : "risk";

/** What this browser has, with no account involved. Also the fallback for
 *  every failure path below: a settings read that cannot reach the database
 *  must not reset anyone's sizing. */
export function localSettings(): UserSettings {
  return { unit: readUnit(), mode: readUnitMode(), multiple: readMaxRiskMultiple() };
}

function mirror(s: UserSettings): void {
  writeUnit(s.unit);
  writeUnitMode(s.mode);
  writeMaxRiskMultiple(s.multiple);
}

/** The signed-in user's settings, mirrored into this browser's prefs. Null
 *  when accounts are off, nobody is signed in, or the read failed — callers
 *  then keep `localSettings()`. */
export async function fetchMySettings(): Promise<UserSettings | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("my_settings");
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as
      { unit_size: number; sizing_mode: string; risk_multiple: number } | undefined;
    if (!row) return null;
    const s: UserSettings = {
      unit: clampUnit(row.unit_size),
      mode: modeOf(row.sizing_mode),
      multiple: clampRiskMultiple(row.risk_multiple),
    };
    mirror(s);
    return s;
  } catch {
    return null;
  }
}

/** Write them to the account AND to this browser. Returns an error message,
 *  or null on success. The mirror happens FIRST so the sizing this session
 *  uses matches what the user just pressed even if the write is refused —
 *  and the message says the account copy did not take. */
export async function saveMySettings(s: UserSettings): Promise<string | null> {
  const clean: UserSettings = {
    unit: clampUnit(s.unit),
    mode: modeOf(s.mode),
    multiple: clampRiskMultiple(s.multiple),
  };
  mirror(clean);
  if (!supabase) return null;
  try {
    const { error } = await supabase.rpc("set_my_settings", {
      p_unit: clean.unit, p_mode: clean.mode, p_mult: clean.multiple,
    });
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
