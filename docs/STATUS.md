# Proofline status (11 Nov 2026)

```mermaid
flowchart LR
  subgraph Teammate["Teammate: backend"]
    PP[PayPal sandbox<br/>orders, captures, completion,<br/>disputes, webhooks]
    API[Backend API<br/>projects + evidence<br/>with provenance + sha256]
  end
  subgraph Adapter["Seam (built)"]
    GPD["getProoflineData()<br/>lib/store.ts"]
  end
  subgraph You["You: frontend, AG Studio, AI"]
    CC[1 Command center ✅]
    MX[2 Evidence matrix ✅ base<br/>⏳ cell card + options]
    TL[3 Timeline ✅ · Provenance card ⏳]
    PD[4 Project page ✅ · /intake ⏳]
    NM[5 Notice mapper: AI ✅ · page ⏳]
    AG[6 AI Investigator ⏳]
  end
  PP --> API --> GPD --> CC & MX & TL
  GPD --> PD
  NM --> GPD
  AG --> GPD
  DEMO[7 Integrate + 3-min demo ⏳]
  You --> DEMO
  Teammate --> DEMO
```

- **Built:** Studio command center (KPIs, matrix, donut, gaps, recent activity), timeline widget, project page with
  intake and PayPal actions, AI extract and notice mapping, plus a stand-in backend (SQLite, PayPal calls, webhook route).
- **Teammate:** the real backend replaces `lib/db.ts`, `lib/store.ts`, `lib/paypal.ts`, `app/actions.ts` and the API
  routes; it must return projects and evidence with provenance and sha256, so `getProoflineData()` keeps its shape.
- **You, next:** matrix cell card and Studio options (decided), provenance card, `/notice` page, `/intake`, then the
  AI Investigator agent.
- **Shared, last:** wire the frontend to the teammate's API, deploy, record the demo.
