
import ESI from 'eve-esi-client';
import MemoryProvider from 'eve-esi-client/dist/providers/memory.js';
import Koa from 'koa';

import { CLIENT_ID, SECRET } from "./secret.js";
import { CorpContacts, getCorpContacts, IStatus } from "./api/corpContacts.js";
import { CHARACTERS_BY_ID, CHARACTERS_BY_NAME } from "./data/characters.js";
import { Routes } from './routes.js';


const PORT = 8002;
const CALLBACK_URI = 'https://www.garbagecollectorb.com/callback'
const provider = new MemoryProvider();
const esi = new ESI({
    provider,
    clientId: CLIENT_ID,
    secretKey: SECRET,
    callbackUri: CALLBACK_URI
});



async function getUser(ctx: any) {
    const user_id: number = CHARACTERS_BY_NAME[ctx.params.user]
    if (user_id == null) {
        ctx.body = `Invalid user: ${ctx.params.user}`
    } else {
        const redirectUrl = esi.getRedirectUrl('some-state', CHARACTERS_BY_ID[user_id].authorisations);
        ctx.body = `<a href="${redirectUrl}">Log in using Eve Online</a>`;
    }
}

async function getCallback(ctx: any) {
    const code = String(ctx.query.code);
    const { character } = await esi.register(code);

    ctx.res.statusCode = 302;
    ctx.res.setHeader('Location', `/welcome/${character.characterId}`);
}


async function getWelcome(ctx: any) {
    const characterId = Number(ctx.params.characterId)
    const character = await provider.getCharacter(characterId)
    const token = await provider.getToken(characterId, 'esi-contracts.read_corporation_contracts.v1')
    const character_name: string = character.characterName.toLowerCase().replace(" ", "_")
    let body = `<h1>Welcome, ${character_name}!</h1>`

    const response = await esi.request<CorpContacts[]>(
        `/corporations/${CHARACTERS_BY_ID[character.characterId].corperation_id}/contracts/`,
        null,
        null,
        { token }
    );

    const contracts = await response.json()
    body += `<p>Contacts:</p><ul>`
    for (const contract of contracts) {
        if (contract.assignee_id != CHARACTERS_BY_ID[character.characterId].corperation_id) continue;
        if (contract.status != IStatus.in_progress && contract.status != IStatus.outstanding) continue;
        body += `<li>title:${contract.title},type:${contract.type},price:${contract.price},issuer:${contract.issuer_id}</li>`
    }
    body += '</ul>'
    ctx.body = body
}

const routes = new Routes(getUser, getCallback, getWelcome);
const app = new Koa();
app.use(routes.getRouter().middleware());
app.listen(PORT, function () {
    console.log(`Server listening on port ${PORT}`);
});