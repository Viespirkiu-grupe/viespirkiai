-- Kitų tos pačios bylos sprendimų paieškai pagal teisminio proceso numerį.
--
-- Teisminio proceso nr. byloje nekinta, kai byla keliauja per instancijas, tad
-- aukštesnės instancijos sprendimas (galėjęs žemesnįjį pakeisti ar panaikinti)
-- randamas būtent pagal jį. LITEKO2 pusėje toks indeksas jau yra
-- (sprendimai_teisminisProcesoNr_idx), senajame LITEKO nebuvo — be jo užklausa
-- perskaitytų visą 2.25 mln. eilučių lentelę.
--
-- Naudoja: modules/liteko/nuosprendisPagalUuid.js gautiSusijusiusSprendimus().

CREATE INDEX CONCURRENTLY IF NOT EXISTS "nuosprendziai_teisminisProcesoNr_idx"
    ON liteko.nuosprendziai ("teisminisProcesoNr")
    WHERE "teisminisProcesoNr" IS NOT NULL;
