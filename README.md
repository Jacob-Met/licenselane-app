# LicenseLane

Agree on the use. Keep the exact work you paid for.

## Try the simulated demo

```sh
npm run demo        # or: node demo.js
```

Open <http://127.0.0.1:8787> (set `PORT` to use another port). No PayPal keys, no local model and no network are needed; a "Simulated demo: no real PayPal call" badge stays in the corner.

1. Choose **Describe your use**, then open **Use a project brief**: an example brief from a museum is already filled in. Press **Suggest scope fields**, select the suggested changes and apply them, then add a name, a project, a start date (**Today (UTC)**), `6` months and a territory.
2. Choose **Review price & terms** ($73.00), then **Save proposal for creator**.
3. Open **Inbox**, **Review request**, and press **Creator: approve saved terms**.
4. Press **Create PayPal Sandbox checkout**, follow **Open PayPal Sandbox** to the "Simulated PayPal approval" page and press **Approve**.
5. Back in **Records**, press **Continue checkout**, **Review Sandbox payment**, then **Pay $73.00**. The licence is issued and the download holds the artwork, the exact terms and a certificate.

What is simulated: the PayPal Sandbox calls (token, create order, get order, capture) are answered in-process by a small fake, and the brief reader returns a fixed answer for the example brief. The real PayPal Sandbox and local-model setup is described below.

LicenseLane is a small licensing desk for one independent artist or studio. A buyer describes what they want to do with an artwork, the artist approves the exact terms, the buyer pays through PayPal, and the buyer receives the very file and terms that were approved.

It is for illustrators and photographers who license work to small buyers (a museum guide, a campaign, a book cover) and for those buyers, who usually do not know what to ask for.

## What it does

- Each artwork has a page with its price and the artist's policy: allowed uses, print limits, term, territory, credit, exclusivity and model training.
- The buyer builds a request and sees the price update as they go.
- The request is saved as a proposal. Nothing is charged until the artist approves it.
- The artist reviews proposals in an inbox and approves them or asks for changes.
- An approved request can be paid. When PayPal confirms a completed capture for the agreed amount, the licence is issued and one download holds the original artwork, the exact terms and a certificate.
- Later changes to the catalogue never alter what an existing buyer holds.

## How it uses AI

The buyer can paste a brief they already wrote. A local language model proposes licence fields from it (usage, number of copies, duration, territory, credit, exclusivity, model training) and every suggestion shows the sentence it came from. Responses are checked against a strict schema, and nothing is applied until the buyer selects it. Manual entry always works, including while the model is slow or unavailable. Pricing and policy checks are ordinary deterministic code.

It talks to Ollama on the same machine. It was tested with `qwen2.5:7b`.

## How it uses PayPal

Payments run on the PayPal REST API in **Sandbox** only:

- OAuth 2.0 client credentials (`/v1/oauth2/token`), kept on the server
- Orders v2: create an order for the approved amount with the licence reference (`POST /v2/checkout/orders`), send the buyer to PayPal to approve, capture on the buyer's confirmation (`POST /v2/checkout/orders/{id}/capture`)
- A separate read of the order (`GET /v2/checkout/orders/{id}`) before the licence is issued; issuance checks capture status, USD amount and licence reference

## Run it

Requires Node.js 20 or newer. There are no npm dependencies.

```sh
npm start
# open http://127.0.0.1:8787
```

That is enough to browse, build requests and approve them. To take Sandbox payments and use the brief reader:

```sh
ollama pull qwen2.5:7b

export PAYPAL_CLIENT_ID="your sandbox client id"
export PAYPAL_CLIENT_SECRET="your sandbox client secret"
export OLLAMA_URL="http://127.0.0.1:11434"
export OLLAMA_MODEL="qwen2.5:7b"
export LICENSELANE_DATA="$HOME/.licenselane"

npm start
```

`PORT` and `HOST` change where it listens. On anything other than loopback you must also set `CREATOR_PASSCODE`, which protects the artist's side. Create Sandbox credentials at <https://developer.paypal.com/dashboard/applications/sandbox>. Pay as a Sandbox personal account or with PayPal's Sandbox test cards.

## A two-minute walkthrough

1. Pick an artwork and choose **Describe your use**.
2. Open **Use a project brief**, paste a brief and choose **Suggest scope fields**. Apply the suggestions you agree with and fill in the rest.
3. **Review price & terms**, then **Save proposal for creator**.
4. Open **Inbox**, **Review request**, and approve the saved terms.
5. **Create PayPal Sandbox checkout**, open PayPal and pay as the Sandbox buyer.
6. Back in **Records**, continue the checkout, review the payment and confirm it. The licence is issued and the files can be downloaded.

The sample artworks in `public/assets` are original and included under the same licence as the code.

## Tests

```sh
npm test
```

Some replay tests are skipped because they read recorded model responses that are not part of this repository.

## License

MIT. See [LICENSE](LICENSE). The bundled typeface has its own licence in `public/fonts`.
