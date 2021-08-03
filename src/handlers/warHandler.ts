import ESI, { Token } from 'eve-esi-client';
import MongoProvider from 'eve-esi-client-mongo-provider';
import { red, amber, green, DiscordNotifier, purple, } from '../notifier/discordNotifier';
import { EmbedFieldData, MessageEmbed } from 'discord.js';
import { AcceptedChannelMongo } from '../daos/discordDAO';
import { Corperation, getCorperationInfo } from '../api/corperation/corperationAPI';
import { getAllianceIconURL, getCorperationIconURL } from '../data/images';
import { Ally, getWar, getWars, War } from '../api/warAPI';
import { WarsQueries } from '../daos/warsDAO';
import { CorpWar, CorpWarsQueries } from '../daos/corpWarsDAO';
import { CharacterMongo } from '../daos/userDAO';
import { getAllianceInfo } from '../api/allianceAPI';

enum WAR_MESSAGE_TYPE {
    NEW,
    UPDATE,
    FINISHED
}

const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day:"numeric"
};

export async function syncWar(provider: MongoProvider, esi: ESI, discordNotifier: DiscordNotifier, channels: Array<AcceptedChannelMongo>, characters: Array<CharacterMongo>, corperationsInOrder: Array<Corperation>): Promise<void> {
    try {

        //Request update from Eve API
        const token: Token = await provider.getToken(characters[0].characterId);
        const wars: Array<number> = await getWars(esi, token);

        //Remove any contacts that aren't in the original request.
        await WarsQueries.removeOldWars(provider, wars);

        //Get all new wars
        const newWars = await WarsQueries.getAllNotSavedYet(provider, wars);

        for (const newWar of newWars) {
            try{
                //Slow down pace in attempt to stop gateway errors
                await new Promise(resolve => setTimeout(resolve, 60));
                // Get New War details
                const warDetail = await getWar(esi, token, newWar);
                // Save New War details
                await WarsQueries.saveOrUpdateWar(provider, warDetail);
                
                // Cycle characters
                for (let corperation of corperationsInOrder) {
                    try {
                        // Move on if character isn't war eligible.
                        if (!corperation.war_eligible) continue;
                        // Check if involed
                        if (isInvolvedInWar(warDetail, corperation)) {
                            //Check if we knew about it
                            if (! await CorpWarsQueries.isPresent(provider, corperation.corperation_id, warDetail)) {
                                //NEW WAR! Notify Discord
                                const warType: WAR_MESSAGE_TYPE = warDetail.finished ? WAR_MESSAGE_TYPE.FINISHED : WAR_MESSAGE_TYPE.NEW;
                                const message: MessageEmbed = await compileEmbedMessage(provider, esi, corperation, token, warDetail, warType);
                                discordNotifier.postChannelsMsg(channels, message);
                            }
                            await CorpWarsQueries.saveOrUpdateWar(provider, corperation.corperation_id, warDetail)
                        }
                    } catch (e) {
                        console.error(`warDetail ${corperation.corperation_id}`,e);
                    }
                }
            }catch(e){
                console.error(`warDetail ${newWar}`, e);
            }
        }

        // Check on existing wars
        // Cycle characters
        for (let corperation of corperationsInOrder) {
            try {
                // Move on if character isn't war eligible.
                if (!corperation.war_eligible) continue;
                const corpWars: Array<CorpWar> = await CorpWarsQueries.getCorpWars(provider, corperation.corperation_id);

                for (const corpWar of corpWars) {
                    // Get War details
                    const warDetail = await getWar(esi, token, corpWar.id);
                    if (await CorpWarsQueries.hasChanged(provider, corperation.corperation_id, warDetail)) {
                        const warType: WAR_MESSAGE_TYPE = warDetail.finished ? WAR_MESSAGE_TYPE.FINISHED : WAR_MESSAGE_TYPE.UPDATE;
                        //Notify change to War!
                        const message: MessageEmbed = await compileEmbedMessage(provider, esi, corperation, token, warDetail, warType);
                        discordNotifier.postChannelsMsg(channels, message);
                        //Update new war detail!
                        await CorpWarsQueries.saveOrUpdateWar(provider, corperation.corperation_id, warDetail)
                    }
                }
            } catch (e) {
                console.error(`existing war checks ${corperation.corperation_id}`,e);
            }
        }
    } catch (e) {
        console.error("syncWar", e)
        return null;
    }
}

function isInvolvedInWar(warDetail: War, corperation: Corperation): boolean {
    if(corperation.alliance_id){
        if(warDetail.aggressor.alliance_id){
            if (warDetail.aggressor?.alliance_id == corperation?.alliance_id) return true;
        }
        if(warDetail.defender.corporation_id){
            if (warDetail.defender?.alliance_id == corperation?.alliance_id) return true;
        }
    }else{
        if(warDetail.aggressor.alliance_id){
            if (warDetail.aggressor?.corporation_id == corperation?.corperation_id) return true;
        }
        if(warDetail.defender.corporation_id){
            if (warDetail.defender?.corporation_id == corperation?.corperation_id) return true;
        }
    }
    for (const ally of warDetail.allies) {
        if(corperation.alliance_id && ally.alliance_id){
            if (ally?.alliance_id == corperation?.alliance_id) return true;
        }
        if(corperation.corperation_id && ally.alliance_id){
            if (ally?.corporation_id == corperation?.corperation_id) return true;
        }
    }
    return false;
}

function isAggressor(warDetail: War, corperation: Corperation): boolean {
    if(warDetail.aggressor.alliance_id && corperation.alliance_id){
        if (warDetail.aggressor?.alliance_id == corperation?.alliance_id) return true;
    }
    if (warDetail.aggressor.corporation_id && corperation.corperation_id){
        if (warDetail.aggressor?.corporation_id == corperation?.corperation_id) return true;
    }
    for (const ally of warDetail.allies) {
        if(ally.alliance_id && corperation.alliance_id){
            if (ally?.alliance_id == corperation?.alliance_id) return true;
        }
        if(ally.corporation_id && corperation.corperation_id){
            if (ally?.corporation_id == corperation?.corperation_id) return true;
        }
    }
    return false;
}

async function getAggressorName(esi: ESI, token: Token, warDetail: War): Promise<string> {
    if(warDetail.aggressor.alliance_id){
        return `**[${(await getAllianceInfo(esi, token, warDetail.aggressor.alliance_id)).name}](https://evemaps.dotlan.net/alliance/${warDetail.aggressor.alliance_id})**` 
    }else{
        return `**[${(await getCorperationInfo(esi, token, warDetail.aggressor.corporation_id)).name}](https://evemaps.dotlan.net/corp/${warDetail.aggressor.corporation_id})**`;
    }
}

async function getDefenderName(esi: ESI, token: Token, warDetail: War): Promise<string> {
    if( warDetail.defender.alliance_id){
        return `**[${(await getAllianceInfo(esi, token, warDetail.defender.alliance_id)).name}](https://evemaps.dotlan.net/alliance/${warDetail.defender.alliance_id})**` 
    }else{
        return `**[${(await getCorperationInfo(esi, token, warDetail.defender.corporation_id)).name}](https://evemaps.dotlan.net/corp/${warDetail.defender.corporation_id})**`;
    }
}

async function getAllyName(esi: ESI, token: Token, ally: Ally): Promise<string> {
    return ally.alliance_id ? (await getAllianceInfo(esi, token, ally.alliance_id)).name : (await getCorperationInfo(esi, token, ally.corporation_id)).name;
}

async function compileEmbedMessage(provider: MongoProvider, esi: ESI, corperation: Corperation, token: Token, warDetail: War, war_type: WAR_MESSAGE_TYPE): Promise<MessageEmbed> {
    const aggressorName = await getAggressorName(esi, token, warDetail);
    const defenderName = await getDefenderName(esi, token, warDetail);
    var title, description = "";
    var colour: number;
    var thumbnail;
    var fields: Array<EmbedFieldData> = [];
    if (warDetail.allies && warDetail.allies.length > 0) {
        fields.push({ name: `Allies with ${defenderName}:`, value: '\u200B' }); //break
        warDetail.allies.forEach(async (ally, index) => {
            const allyName = await getAllyName(esi, token, ally);
            fields.push({ name: `Ally ${index.toString()}`, value: allyName });
        })
    }
    switch (war_type) {
        case WAR_MESSAGE_TYPE.NEW:
            description = `${aggressorName} have declared war to ${defenderName}.`
            if (warDetail.started) {
                fields.push({ name: "Starts at:", value: `${new Date(warDetail.started).toLocaleDateString("en-US", dateOptions)}` });
            }
            if (isAggressor(warDetail, corperation)) {
                title = "WAR CONFIRMED!"
                colour = purple;
                thumbnail = warDetail.defender.alliance_id ? getAllianceIconURL(warDetail.defender.alliance_id) : getCorperationIconURL(warDetail.defender.corporation_id);
            } else {
                title = "WAR DEC'ed!"
                colour = red;
                thumbnail = warDetail.aggressor.alliance_id ? getAllianceIconURL(warDetail.aggressor.alliance_id) : getCorperationIconURL(warDetail.aggressor.corporation_id);
            }
            break;
        case WAR_MESSAGE_TYPE.FINISHED:
            title = 'WAR IS OVER!'
            colour = green;
            description = `The war between ${aggressorName} and ${defenderName} has ended. Finished at: ${new Date(warDetail.finished).toLocaleDateString("en-US", dateOptions)}`
            if (isAggressor(warDetail, corperation)) {
                thumbnail = warDetail.defender.alliance_id ? getAllianceIconURL(warDetail.defender.alliance_id) : getCorperationIconURL(warDetail.defender.corporation_id);
            } else {
                thumbnail = warDetail.aggressor.alliance_id ? getAllianceIconURL(warDetail.aggressor.alliance_id) : getCorperationIconURL(warDetail.aggressor.corporation_id);
            }
            break;
        case WAR_MESSAGE_TYPE.UPDATE:
        default:
            title = 'WAR UPDATE!'
            colour = amber;
            description = `The war between ${aggressorName} and ${defenderName} has been updated.`
            const previousWarDetail = await WarsQueries.getWar(provider, warDetail.id);
            //Check for changes
            if (warDetail.open_for_allies != previousWarDetail.open_for_allies) {
                fields.push({ name: "Open for Allies now:", value: warDetail.open_for_allies.valueOf() });
            }
            if (warDetail.retracted != previousWarDetail.retracted) {
                fields.push({ name: "War retracted changed:", value: `Was: ${new Date(previousWarDetail.retracted).toLocaleDateString("en-US", dateOptions)}, now: ${new Date(warDetail.retracted).toLocaleDateString("en-US", dateOptions)}` });
            }
            if (warDetail.started != previousWarDetail.started) {
                fields.push({ name: "War has started:", value: `${new Date(warDetail.started).toLocaleDateString("en-US", dateOptions)}` });
            }
            //Thumbnail
            if (isAggressor(warDetail, corperation)) {
                thumbnail = warDetail.defender.alliance_id ? getAllianceIconURL(warDetail.defender.alliance_id) : getCorperationIconURL(warDetail.defender.corporation_id);
            } else {
                thumbnail = warDetail.defender.alliance_id ? getAllianceIconURL(warDetail.defender.alliance_id) : getCorperationIconURL(warDetail.defender.corporation_id);
            }
            break;
    }

    const embed = new MessageEmbed()
        .setAuthor(`${corperation.name}`, getCorperationIconURL(corperation.corperation_id))
        .setTitle(title)
        .setColor(colour)
        .setDescription(description)
        .setThumbnail(thumbnail)
        .setFooter('Declared:')
        .setTimestamp(new Date(warDetail.declared))
    fields.push({ name: "Dotland.net:", value: `https://evemaps.dotlan.net/war/${warDetail.id}` })
    if (fields) embed.addFields(fields);
    return Promise.resolve(embed);
}

