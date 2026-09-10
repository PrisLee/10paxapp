# Turning on the shared database

Without this, 10 Pax works exactly as it always has: the roster rides inside the share
link and answers travel as copy-paste codes. The badge in the top corner says
**THIS DEVICE**.

Do the five minutes below and the badge turns to **LIVE**: everybody's answers arrive
by themselves, the codes disappear, and Group view updates as people reply.

Nothing here costs money. Firestore's free tier is far more than ten people need, and
unlike some alternatives it does not pause when the app sits unused between gatherings.

## 1. Make a Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Add project** → give it a name (`10pax` is fine) → continue.
3. Google Analytics: **turn it off**. Nothing here needs it.

## 2. Create the database

1. In the left sidebar: **Build → Firestore Database** → **Create database**.
2. Pick a location near you (`asia-southeast1` for Singapore).
3. Start in **production mode**. The rules in step 4 replace the defaults anyway, and
   test mode would leave the database open to the whole internet after 30 days.

## 3. Get your config

1. **Project settings** (the gear, top left) → scroll to **Your apps**.
2. Click the web icon `</>`, register the app with any nickname, skip hosting.
3. You get a `firebaseConfig` block. Copy each value into `firebase-config.js` in this
   repo, keeping the quotes:

   ```js
   window.PAX_FIREBASE = {
     apiKey: "AIza…",
     authDomain: "10pax-xxxxx.firebaseapp.com",
     projectId: "10pax-xxxxx",
     storageBucket: "10pax-xxxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef"
   };
   ```

These values are **not secrets**. They identify the project; they do not grant access.
Every Firebase web app ships them in public JavaScript. Access is controlled entirely
by the rules in the next step, which is why that step is not optional.

## 4. Paste in the security rules

In **Firestore Database → Rules**, replace everything with the contents of
[`firestore.rules`](firestore.rules) from this repo, then **Publish**.

Read the comments at the top of that file before you publish. The short version: a
group id is a long random string that only exists in the share link, and holding the
link grants read and write to that group. The rules make group ids **undiscoverable**
(`get` is allowed, `list` is not, so nobody can enumerate the collection) and cap the
shape and size of what can be written. What they deliberately do **not** do is
authenticate anybody.

## 5. Publish

```bash
python3 build.py
git add -A && git commit -m "Add Firebase config" && git push
```

Wait a minute for GitHub Pages to rebuild, open the site, and the badge should read
**LIVE**. In Roster, hit **Make it shared** to turn your current group into a shared
one — answers already on your device come along with it. The link changes to a short
`#g=…` form. Send that to everybody.

## What "the link is the key" actually means

Be clear-eyed about this, because it is the trade-off you chose in exchange for nobody
having to sign up:

- Anyone holding the link can read the group and change **anything** in it, including
  answering as somebody else or deleting the group.
- A link that leaks cannot be revoked. Delete the group and make a new one.
- Group ids cannot be guessed or enumerated, so the risk is a shared link, not a
  stranger stumbling in.

For ten friends who already share a group chat, that is a reasonable trade. Do not use
it for anything you would mind being read or edited by whoever ends up with the URL.

## Costs and limits

Firestore's free tier covers 50,000 reads and 20,000 writes a day, and 1 GiB stored.
A ten-person group finding a date uses a handful of writes and a few hundred reads.
You will not come close. Set a **budget alert** in Google Cloud anyway if you want to
sleep soundly.

## Turning it back off

Blank out the values in `firebase-config.js`, rebuild, and push. The app returns to
link-and-codes mode. Groups already in Firestore stay there until you delete them
(Roster → **Delete this group**, or from the Firebase console).
