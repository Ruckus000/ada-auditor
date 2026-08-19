# Journeys over the API

For CI and scripts. Operators use the console — these endpoints exist so a
pipeline can register and run journeys with the machine credential
(`AUDITOR_RUN_TOKEN`), which is deliberately not something the UI teaches
humans to hold: what it does is not attributed to a person.

Create a journey:

    curl -X POST https://<host>/api/platform/clients/<clientId>/journeys \
      -H "authorization: Bearer $AUDITOR_RUN_TOKEN" \
      -H "content-type: application/json" \
      -d '{"name":"Checkout","targetUrl":"https://client.example/",
           "steps":[{"action":"navigate","type":"goto","path":"/"}]}'

Run it: `POST /api/platform/clients/<clientId>/journeys/<journeyId>/runs`.
Verify without auditing: `POST .../journeys/<journeyId>/preview`.
Archive: `DELETE .../journeys/<journeyId>`.

Steps must satisfy `authoredStepSchema` (`src/domain/journey-step.ts`).
Credentials are always `credentialRef` — a literal password in a step body is
refused as `inline_credential`, and so is a `targetUrl` that embeds one.
