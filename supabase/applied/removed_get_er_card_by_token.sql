-- RESTORE SCRIPT — public.get_er_card_by_token(text)
--
-- Dropped from prod on 2026-09-12 (see migration 00000000000011). Kept here
-- verbatim so the ER-card feature can be restored exactly when `tend` returns.
--
-- Why it was dropped: it returns a complete emergency medical card (name, DOB,
-- blood type, conditions, allergies, ICE contacts, healthcare proxy, DNR
-- status, insurance, medications) to any caller holding a token, and
-- public.shared_er_cards was empty with no code path creating tokens — the only
-- caller was the retired `tend` web app.
--
-- Note for whoever restores this: patch_harden_rpcs.sql says the grant was left
-- in place deliberately because "an EMT scanning the card has no account". But
-- the grant was to `authenticated` only, never `anon`, so an EMT without an
-- account could not have called it anyway. Decide which half was intended
-- before restoring: if EMTs really should reach it, it needs an anon grant plus
-- something stronger than a bearer token (short TTL, one-time use, rate limit).

create or replace function public.get_er_card_by_token(token_in text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
  declare
    card_row record;
    parent_row record;
    meds json;
    result json;
  begin
    select * into card_row
      from public.shared_er_cards
      where token = token_in
        and revoked_at is null
        and expires_at > now()
      limit 1;

    if card_row is null then
      return null;
    end if;

    select * into parent_row
      from public.parents
      where id = card_row.parent_id
      limit 1;

    if parent_row is null then
      return null;
    end if;

    select coalesce(
      json_agg(
        json_build_object(
          'name', m.name,
          'dose', m.dose,
          'purpose', m.purpose,
          'schedule', m.schedule,
          'prescriber', m.prescriber
        ) order by m.name
      ),
      '[]'::json
    )
    into meds
    from public.medications m
    where m.parent_id = card_row.parent_id;

    result := json_build_object(
      'parentName',      parent_row.name,
      'nickname',        parent_row.nickname,
      'dob',             parent_row.dob,
      'bloodType',       parent_row.blood_type,
      'conditions',      parent_row.conditions,
      'allergies',       parent_row.allergies,
      'iceContacts',     parent_row.ice_contacts,
      'healthcareProxy', parent_row.healthcare_proxy,
      'dnrStatus',       parent_row.dnr_status,
      'primaryDoctor',   parent_row.primary_doctor,
      'pharmacy',        parent_row.pharmacy,
      'insurance',       parent_row.insurance,
      'medications',     meds,
      'lastVerifiedAt',  parent_row.last_verified_at,
      'expiresAt',       card_row.expires_at
    );
    return result;
  end;
$function$;

-- The grant as it stood when dropped (authenticated only, no anon):
-- grant execute on function public.get_er_card_by_token(text) to authenticated;
