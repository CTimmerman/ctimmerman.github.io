"use strict"
onbeforeunload = () => false
const BANLIST = ["GD01-020"]
const BANNED_PAIRS = [["ST01-010", "ST05-010"], ["GD01-008", "GD05-015"]]
const RESTRICTED = { "ST02-016": 2 }
let zoomed = ""
let title = "Gundam Card Game implementation by Cees Timmerman, 2026-05-11 - 09-18"
document.title = title

function dict2str(d) {
	const keys = []
	for (const k in d) keys.push(k)
	let s = ""
	keys.sort()
	for (const k of keys) s += "" + k + ": " + d[k] + "\n";
	return s.slice(0, -1)
}

function clamp(e) {
	let v = parseInt(e.value)
	e.value = parseInt(v > e.max ? e.max : e.value < e.min ? e.min : e.value)
}

function setVolume() {
	// complete silence pauses execution while screen is locked
	boom.volume = Math.max(0.005, parseFloat(volume.value))
	pewpew.volume = boom.volume
}
setVolume()

let active_player = null
let spent = []
let attacker = null
let defender = null
let once_per_turn = []

let CARDS = {}
let DEBUG_ID = "FOO"
let DEBUG_ACT = "Main"
// Why doesn't upstream list EXR promos like other promos?
// "EXR-001_PR", "EXR-001_PR2", "EXR-001_PR3", "EXR-001_PR4", "EXR-001_PR5"
const EX_RESOURCES = ["EXR-001", "EXRP-001", "EXRP-002"]
let chosen = null

/** TODO: top of deck */
async function chooseCard(targets, prompt = "") {
	chosen = null
	if (targets.length < 1) return null
	// TODO: Only if not optional.
	// if (targets.length === 1) return targets[0]
	await render()
	targets.forEach(c => getel(c).classList.add("glow"))
	let time_left = 60
	while (chosen === null) {
		await sleep(1000)
		time_left -= 1
		dtimeleft.innerHTML = prompt + "⏳" + time_left + "s [Skip]"
		dtimeleft.style.display = "block"
		if (time_left <= 0) break
	}
	dtimeleft.style.display = "none"
	targets.forEach(c => getel(c).classList.remove("glow"))
	if (!chosen) return null
	const cid = parseInt(chosen.slice(1))
	chosen = cid2card(cid)
	// log(`🎯Chose ${chosen}`)
	return chosen
}

function cid2card(cid) {
	let rv = null
	for (let arr of [p1.battle, p2.battle, p1.hand, p2.hand, [p1.base], [p2.base], p1.trash, p2.trash]) {
		rv = arr.filter(c => c && c.cid === cid)[0]
		if (rv) break
	}
	return rv
}

function countStr(body, str) {
	if (!body) return 0
	return (body.match(new RegExp(str, "g")) || []).length
}

function inStr(body, str) {
	if (!body) return false
	return body.indexOf(str) > -1
}

function mySort(arr, fun) {
	return arr.toSorted((a, b) => fun(a) - fun(b))
}

function escapeHTML(unsafe) {
	return (unsafe || "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;")
		.replaceAll("\n", "<br>")
}
function unescapeHTML(unsafe) {
	return (unsafe || "")
		.replaceAll(/<br ?\/?>/g, "\n")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#039;", "'")
}

function clear(card) {
	card.ap_eob = 0
	card.ap_eot = 0
	card.damage = 0
	card.hp_eob = 0
	card.hp_eot = 0
	card.rested = false
	card.sick = false
	card.stunned = false
	card.kw_eob = []
	card.kw_eot = []
	card.pilot = null
	card.unit = null
	if (card.id === "GD05-089") {
		card.type = "PILOT"
		card.ap = 2
		card.hp = 2
	}
}

function toHand(card, fromTrash = false) {
	log(`🎴${card.owner.name} took ${card}`)
	if (fromTrash) card.owner.trash = card.owner.trash.filter(c => c !== card)
	clear(card)
	card.owner.hand.push(card)
	return true
}

function bounce(card) {
	if (!card) return false
	// log("🔙Bounce " + card)
	card.owner.battle = card.owner.battle.filter(c => c !== card && c !== card.pilot)
	if (card.pilot) toHand(card.pilot)
	if (card.unit) card.unit.pilot = null
	toHand(card)
	return true
}

function exile(cards) {
	for (const card of cards) {
		const p = card.owner
		log(`♻️${card.owner.name} exiles ${card} from trash`)
		p.trash = p.trash.filter(c => !cards.includes(c))
	}
}

function trash(card) {
	// Spams after destroy and command
	// log("🗑️Trash " + card)
	clear(card)
	card.owner.trash.push(card)
}

async function destroy(card, ctx, destroy_effect = true) {
	if (!card || card.owner.trash.includes(card) ||
		(destroy_effect && card.isUnit() && card.hasKw("can't be destroyed by enemy effects") && ctx.running_card.owner !== card.owner)) return false
	log("💥Destroy " + card)
	if (inStr(card.type, "BASE")) {
		card.owner.base = null
	} else {
		card.owner.battle = card.owner.battle.filter(c => c !== card)
	}
	if (card.pilot) trash(card.pilot)
	// tokens don't go to trash
	if (card.type.indexOf("TOKEN") < 0 && card.type.indexOf("EX") !== 0) trash(card)
	await run(card, "Destroyed", "", ctx)
	if (delay === 0) return true
	await render()
	await boom.play().catch(ex => { })
	await sleep(500)
	return true
}

let delay = 1
let maxDelay = 2
function setSpeed() {
	delay = maxDelay - maxDelay * parseFloat(nspeed.value) / parseFloat(nspeed.max)
	boom.playbackRate = Math.max(1, 4 * parseFloat(nspeed.value) / parseFloat(nspeed.max))
	pewpew.playbackRate = boom.playbackRate
}
setSpeed()
async function sleep(ms = 1000) {
	if (delay === 0) return
	do {
		await new Promise(r => setTimeout(r, delay * ms))
	} while (delay === maxDelay && !window.stop)
}

function getel(card) {
	return document.getElementById("c" + card.cid)
}

async function activate(card, effect = false) {
	if (card.stunned) {
		card.stunned = false
		return
	}
	card.rested = false
	if (card.pilot) card.pilot.rested = false
	if (effect) {
		log("🎯Activate " + card)
		await run(card, "", " is set as active by an effect, ")
	}

	if (delay === 0) return
	try {
		getel(card).classList.remove("rested")
		if (card.pilot) getel(card.pilot).classList.remove("rested")
	} catch (ex) {
		// Not rendered yet.
	}
}

function rest(card, ctx = {}) {
	if (ctx.rester) {
		let base = card.owner.base
		if (card.type === "UNIT" && active_player === card.owner && base && !base.rested && inStr(base.text, "During your turn, when you would rest a Unit with a friendly (League Militaire) Unit's effect, you may rest this Base instead.")) {
			let rester = (ctx.rester.isUnit() ? ctx.rester : ctx.rester.unit)
			if (rester && rester.hasTrait("League Militaire")) card = base
		}
		log("💤Rest " + card)
	}
	card.rested = true
	if (card.pilot) card.pilot.rested = true
	if (delay === 0) return
	try {
		getel(card).classList.add("rested")
		if (card.pilot) getel(card.pilot).classList.add("rested")
	} catch (ex) {
		// Not rendered yet.
	}
}

async function battle(att, def) {
	if (delay === 0) return
	await render()
	/* Too much hassle to move the pilots at well
	const e = getel(att)
	const old_top = e.style.top
	const old_left = e.style.left
	const e2 = getel(def)
	e.style.top = e2.style.top
	e.style.left = e2.style.left
	await sleep(800)
	e.style.top = old_top
	e.style.left = old_left
	*/
	const sa = getel(att).style
	const sd = getel(def).style
	let x1 = parseFloat(sa.left) + 5
	let y1 = parseFloat(sa.top) + 5
	let x2 = parseFloat(sd.left) + 5
	let y2 = parseFloat(sd.top) + 5
	// Laser time!
	overlay.style.display = "block"
	overlay.innerHTML = `<svg id="boardbg" style="height:100vmin;width:100vmin">
				<line x1="${x1}vmin" y1="${y1}vmin" x2="${x2}vmin" y2="${y2}vmin" stroke="white" stroke-width="4px" stroke-linecap="round">
					<animate attributeName="stroke" values="#880;#fff;#880;" dur="0.2s" repeatCount="indefinite"/>
					<animate attributeName="stroke-width" values="2px;8px;2px;" dur="0.2s" repeatCount="indefinite"/>
				</line>
			</svg>`
	// vfx
	await sleep(400)
	// sfx
	await pewpew.play().catch(ex => { })
	overlay.style.display = "none"
}

function compareDecks() {
	delay = 1
	const deck1 = decks[p1deck.value].split("\n")
	const deck2 = decks[p2deck.value].split("\n")
	log(`\nDeck 1: ${decks[p1deck.value]}\nDeck 2: ${decks[p2deck.value]}`)
	let i1 = 0
	let i2 = 0
	while (i1 < 1000) {
		const L1 = deck1[i1]
		const L2 = deck2[i2]
		if (!L1 && !L2) break
		if (L1 && L1[0] === "#") {
			++i1
			continue
		}
		if (L2 && L2[0] === "#") {
			++i2
			continue
		}
		if (L1 !== L2) log(`${L1} !== ${L2}`)
		++i1
		++i2
	}
	setSpeed()
}

/** Tries several alternate deck versions and saves any better one as custom deck 3.
 * 🧪Mutant 455 vs original: 137%
 * ⚔️9/999 upgrades in 230.97m. ETA 25406.60m
 */
async function mutateDeck() {
	if (!window.game_over) {
		alert("Please end the current games before testing.")
		return
	}
	let version = 0
	let better = false
	// let old_win_perc = 0
	// let wp_history = []
	// 6000+ is a common place to find improvements to a good AI deck.
	while (version < 99999 && !window.stop) {
		++version
		delay = 1
		let decklist = p1deck.value < 0 ? decks[rnd(0, decks.length - 1)] : decks[p1deck.value]
		let lines = decklist.split("\n")
		log(`\n🧪Mutating ${lines[0]}, v${version}`)
		let fulldeck = []
		let alerts = []
		let deckname = ""
		let tries = 0
		let delta = 0
		let dl = ""
		let changes = 0
		let lastline = -1
		let changelog = []
			;[fulldeck, alerts, deckname] = parseDecklist(decklist)
		let oldalerts = new Set(alerts)
		let maxchanges = rndPick([2, 4])
		do {
			tries += 1
			let i = rnd(0, lines.length - 1)
			if (i === lastline) continue
			if (lines[i].indexOf("# ") === 0) continue
			let [count, id, ...rest] = lines[i].split(" ")
			count = parseInt(count)
			if (!(count >= 0)) continue
			const d = delta ? -delta : rndPick([-1, 1, -2, 2, -3, 3, -4, 4])
			if (count + d < 0) continue
			else if (count + d > 4) continue
			let oldcount = count
			lastline = i
			count += d
			lines[i] = `${count} ${id} ${rest.join(" ")}`
			let change = `${oldcount} -> ${lines[i]}`
			log(change)
			changelog.push(change)
			dl = lines.join("\n")
				;[fulldeck, alerts, deckname] = parseDecklist(dl)
			changes += 1
			delta = d
		} while (changes < maxchanges && tries < 99_999)
		let newalerts = (new Set(alerts)).difference(oldalerts)
		if (newalerts.size > 0) {
			log(`🧪Mutate fail: ${changes} changes in ${tries} tries; ${[...newalerts]}${oldalerts.length > 0 ? "; new alerts since " + [...oldalerts] : ""}`, true)
			continue
		}
		localStorage.setItem("mutantDeck", `# Mutant deck\n` + dl)
		addCustomDeck()
		log(`🧪Mutated ${lines[0]} in ${tries} cycles:\n${lines.slice(1).join("\n")}\n${alerts}`)
		// Test mutant
		p2deck.value = [...p2deck.options].filter(o => o.innerText === "Mutant deck")[0].value
		nspeed.value = 100
		volume.value = 0
		// Mirrormatch standard deviation sqrt(games) / 2 = 13 wins more or less than 350 (700 games / 2 players).
		let p1w = 0
		let p2w = 0
		let ratio = 0.0
		// sample and verify
		ngames.value = 50
		let batches = 30
		for (let i = batches; i > 0; --i) {
			await playGames()
			p1w += player_wins[0]
			p2w += player_wins[1]
			ratio = p2w / p1w  // inf
			// ratio = p2w / (p1w + p2w)
			if (ratio < 1.11) break
		}
		delay = 1
		log(`🧪Mutant ${version} / ${p1w + p2w} games: ${(100 * ratio).toFixed(0)}%\n${changelog.join("\n")}`, true, false, true)
		// 126%/420 => 102%/99999, but 127% (+2 others >= 126%)/450 => 98%/99999
		// 1.27/500 => 113%/99999, or 78%/99999 :(
		// 1.28/600 => 106%/99999 x2.
		// 1.25/600 => 100%/99999
		// 1.30/600 => 100%/99999
		// (700/2+13)/(700/2-13) * 1.04 = 1.12 for an expected 4% gain, twice the fluctuation of a 700-game mirrormatch.
		// But, 1.12/700 => 98%/99999
		// 1.24/700 => 97%/99999
		// 2.23/700 => 109%/99999
		// 194%/100 + 133%/800 => 106%/99999
		// 1.17/(50*20) => 105%/99999
		// 1.17/(50*30) => 106%/99999
		// 1.16/(50*30) => 105%/99999
		// 1.15/(50*30) => 107%/99999
		if (ratio >= 1.13 && p1w + p2w >= batches * ngames.value) {
			log(`✅Saving ${(100 * ratio).toFixed(0)}% mutant ${version} as custom deck 3 after ${p1w + p2w} games\n${changelog.join("\n")}`, true, true, true)
			localStorage.setItem("customDeck3", `# Custom deck 3\n` + lines.slice(1).join("\n"))
			addCustomDeck()
			better = true
			break
		}
	}
	setSpeed()
	return better
}

/** Autoupgrade deck as custom deck 3.
 * 
 * 2 changes per mutant, 200 games, 127% treshold:
 * 37 upgrades in 1094.73m
 */
async function honeDeck() {
	let upgrades = parseInt(nhone.value)
	bhone.disabled = true
	const deckname = p1deck.options[p1deck.selectedIndex].text
	const hone_start = new Date()
	let better = false
	log(`⚔️Honing ${deckname} x${upgrades} ${hone_start}, ETA ${upgrades * 8}m`, true, true, true)
	for (var i = 1; !window.stop && i <= upgrades; ++i) {
		bhone.innerHTML = `<span class="rotY">⚔️</span>Honing P1 deck ${i}`
		better = await mutateDeck()
		const mspent = (new Date() - hone_start) / 60000
		if (!better) {
			log(`✅${deckname} seems optimal after ${i - 1} upgrades in ${mspent.toFixed(2)}m. Try adding 0-count cards to consider.`, true, true, true)
			break
		}
		upgrades = parseInt(nhone.value)
		let mleft = mspent / i * (upgrades - i)
		let eta = `${mleft.toFixed(2)}m`
		if (mleft > 60) {
			let hleft = Math.floor(mleft / 60)
			mleft = mleft % 60
			eta = `${hleft.toFixed(0)}h ${mleft.toFixed(2)}m`
		}
		log(`⚔️${i}/${upgrades} upgrades in ${mspent.toFixed(2)}m. ETA ${eta}`, true, true, true)
		p1deck.value = [...p1deck.options].filter(o => o.innerText === "Custom deck 3")[0].value
	}
	p1deck.value = [...p1deck.options].filter(o => o.innerText === deckname)[0].value
	p2deck.value = [...p2deck.options].filter(o => o.innerText === "Custom deck 3")[0].value
	if (better) {
		log(`⚔️Honed ${deckname} as Custom deck 3 on ${new Date()}`, true, true)
		compareDecks()
	}
	bhone.innerHTML = `⚔️Hone P1 deck`
	bhone.disabled = false
	return true
}

function parseDecklist(decklist, strict = false, p = p1) {
	let alerts = []
	const basic_lv2s = []
	const colors = []
	const counts = {}
	let deckname = "Anonymous deck"
	const fulldeck = []
	const lines = decklist.split("\n")
	if (lines.length > 0) deckname = lines[0].slice(2)
	for (const line of lines) {
		const [count, id] = line.split(" ")
		if (count >= 1) {
			if (BANLIST.includes(id)) alerts.push("🚩Banned card: " + id)
			for (let i = 0; i < count; ++i) {
				const c = p.getCard(id)
				fulldeck.push(c)
				if (c.level === 2 && c.cost === 1 && c.ap === 2 && c.hp === 2 && c.text === "" && !basic_lv2s.includes(id)) basic_lv2s.push(id)
				if (!colors.includes(c.color)) colors.push(c.color)
				counts[id] = (counts[id] || 0) + 1
				if (counts[id] > 4) alerts.push("🚩Max 4 of " + id)
				if (counts[id] > RESTRICTED[id]) alerts.push(`🚩${id} restricted to ${RESTRICTED[id]}`)
			}
		}
	}
	for (const pair of BANNED_PAIRS) {
		if (fulldeck.some(c => c.id === pair[0]) && fulldeck.some(c => c.id === pair[1])) alerts.push("🚩Banned pair: " + pair)
	}
	if (basic_lv2s.length > 1) alerts.push("🚩Only 1 basic Lv.2 kind allowed: " + basic_lv2s)
	if (colors.length > 2) alerts.push("🚩Deck colors > 2: " + colors)
	if (fulldeck.length !== 50) alerts.push("🚩Deck length not 50: " + fulldeck.length)
	if (alerts.length > 0 && strict) log(alerts.join("<br>"), false)
	return [fulldeck, alerts, deckname]
}

function showDeck(name) {
	window.pause = (window.pause || 0) + 1
	let html = `<div onclick="overlay.style.display = 'none'; window.pause = 0" style="width:100%; height:100%; background-color: #08080888">`
	overlay.style.display = "block"
	let decklist = ""
	for (decklist of decks) {
		if (inStr(decklist.split("\n")[0], name)) {
			break
		}
	}
	let oldcid = cid
	let [fulldeck, alerts, deckname] = parseDecklist(decklist, true)
	html += deckname
	let deck = fulldeck.toSorted(
		(a, b) => {
			for (const c of deckOrder.value) {
				if (c === "T") {
					if (a.type > b.type) return 1
					if (a.type < b.type) return -1
				} else if (c === "L") {
					if (a.level > b.level) return 1
					if (a.level < b.level) return -1
				} else if (c === "C") {
					if (a.cost > b.cost) return 1
					if (a.cost < b.cost) return -1
				} else if (c === "N") {
					if (a.name > b.name) return 1
					if (a.name < b.name) return -1
				}
			}
			return 0
		}
	)
	const cols = deckOrder.value[0]
	let spliton = cols === "T" ? deck[0].type : cols === "L" ? deck[0].level : deck[0].cost
	let left = 10
	let top = 10
	let sumCost = 0
	let sumLevel = 0
	let text = ""
	let idcount = 0
	let counts = {}
	let oldc = null
	for (const c of deck) {
		if (!oldc || c.id !== oldc.id) {
			if (oldc && oldc.id !== c.id) text += `${idcount} ${oldc.id} ${oldc.color[0]}L${oldc.level}C${oldc.cost} ${oldc.name}\n`
			idcount = 1
			oldc = c
		} else idcount += 1

		const keys = ["Type " + c.type, "Color " + c.color, "Level " + c.level, "Cost " + c.cost, "AP " + c.ap, "HP " + c.hp]
		for (const zone of c.zones) keys.push("Zone " + zone)
		for (const trait of c.traits) keys.push("Trait " + trait)
		for (const link of c.link.split("/")) link && keys.push("Link " + link)
		let pn = getPilotName(c)
		if (pn) keys.push("Pilot " + pn)
		for (let k of keys) counts[k] = 1 + (counts[k] || 0)

		sumCost += c.cost
		sumLevel += c.level
		if ((cols === "T" && spliton !== c.type)
			|| (cols === "L" && spliton !== c.level)
			|| (cols === "C" && spliton !== c.cost)) {
			spliton = cols === "T" ? c.type : cols === "L" ? c.level : c.cost
			left += 11
			top = 10
		}
		let classes = alerts.some(a => inStr(a, c.id)) ? "bad" : ""
		html += c.toHTML(left, top, classes, 0, true)
		top += 4
		if (top > 54) {
			left += 11
			top = 10
		}
	}
	overlay.innerHTML = html + `<br>avg cost ${(sumCost / 50).toFixed(2)}; avg level ${(sumLevel / 50).toFixed(2)}
			<textarea id="tastats" style="top: 70vmin; left: 52vmin; width: 34vmin; height: 20vmin;" onclick="event.stopPropagation()">${dict2str(counts)}</textarea>
<textarea id="tadecklist" style="top: 70vmin; left: 0vmin; width: 50vmin; height: 20vmin;" onclick="event.stopPropagation()">${alerts.join("\n")}
${text}${idcount} ${oldc.id} ${oldc.color[0]}L${oldc.level}C${oldc.cost} ${oldc.name}\n</textarea><div style="position: absolute; top: 90vmin; left: 10vmin;"><button onclick="saveCustomDeck(tadecklist.value)">Save custom 1</button> <button onclick="saveCustomDeck(tadecklist.value, 2)">Save custom 2</button></div></div>`
}

function zoom(e) {
	zoomed = e
	event.preventDefault()
	event.stopPropagation()
	if (inStr(e.style.transform, "scale")) {
		e.style.transform = e.old_transform
		e.style.zIndex = e.old_zIndex
		e.style.top = e.old_top
		e.style.left = e.old_left
		if (window.pause && window.pause > 0) window.pause -= 1
	} else {
		e.old_transform = e.style.transform
		e.old_zIndex = e.style.zIndex
		e.old_top = e.style.top
		e.old_left = e.style.left

		e.style.transform = "scale(5)"
		e.style.zIndex = 9000
		if (parseInt(e.old_top) < 40) e.style.top = "40vmin"
		e.style.left = "40vmin"
		window.pause = (window.pause || 0) + 1
	}
}

function log(s = "", escape = true, con = false, status = false) {
	s = "" + s
	if (delay > 0 || inStr(s, " start:")) {
		dlog.innerHTML += (escape ? escapeHTML(s) : s) + "<br>"
		dlog.scrollTop = dlog.scrollHeight
	}
	if (con || status) {
		dstatus.innerText = s
		if (con) console.log(s)
	}
}

function rnd(min, max) {
	return Math.floor(min + Math.random() * (1 + max - min))
}

function rndPick(arr) {
	return arr[Math.floor(Math.random() * arr.length)]
}
// var Type;
// (function (Type) {
// 	Type[Type["RESOURCE"] = 0] = "RESOURCE";
//     Type[Type["BASE"] = 1] = "BASE";
//     Type[Type["COMMAND"] = 2] = "COMMAND";
//     Type[Type["PILOT"] = 3] = "PILOT";
// 	Type[Type["UNIT"] = 4] = "UNIT";
// 	Type[Type["UNITTOKEN"] = 5] = "UNITTOKEN";	
// })(Type || (Type = {}));

function getPilotName(card) {
	if (card.type === "PILOT") {
		let brace = card.name.indexOf(" (")
		if (brace > -1) return card.name.slice(0, brace)
		return card.name
	}
	if (card.type === "COMMAND") {
		let rv = getSectionText(card, "Pilot")
		return rv.slice(1, rv.indexOf(" ("))
	}
	return ""
}

async function pair(unit, pilot, ctx = {}) {
	log(`🧑‍✈️Pair ${pilot.AP()}/${pilot.HP()} #${pilot.cid} ${getPilotName(pilot)} & ${unit}`)
	unit.pilot = pilot
	pilot.unit = unit
	await render()
	await run(unit, "When Paired", "", ctx)
	await publish("When you pair ", active_player.battle, {paired_unit: unit})
	// await run(unit, "During Pair")
	if (unit.link && linksWith(unit, pilot)) {
		log("🔗Link")
		unit.sick = false
		await run(unit, "When Linked", "", ctx)
		await run(unit.owner.base, "", " Unit links, ", {...ctx, active_unit: unit})
		// await run(unit, "During Link", "", ctx)
	}
}

function linksWith(unit, pilot) {
	if (!pilot) return false
	let pilot_name = getPilotName(pilot)
	for (let part of unit.link.split("/")) {
		if (part === `[${pilot_name}]`) return true // (Neil)
		if (part === `[${pilot.name}]`) return true // (Machu)
		if (pilot_name === "Quattro Bajeena" && part === "Char Aznable") return true
		if (inStr(part, " Trait")) part = part.slice(0, -6)
		if (pilot.hasTrait(part.slice(1, -1))) return true
	}
	return false
}

class Card {
	constructor(type = "UNIT",
		name = "",
		ap = 0,
		hp = 0,
		level = 0,
		cost = 0,
		text = "",
		zones = [],
		traits = [],
		link = "",
		id = "",
		color = "BROWN") {
		this.id = id
		this.color = ["WHITE", "BLUE", "PURPLE", "RED", "GREEN"].indexOf(color) >= 0 ? color : "BROWN"
		this.level = parseInt(level) || 0
		this.cost = parseInt(cost) || 0
		// let type_num = parseInt(type) || type === 0? Type.RESOURCE : Type.UNITTOKEN
		// if (Type[type]) {
		// 	// number or string, we want number here
		// 	type_num = parseInt(type)? type : Type[type]
		// }
		this.type = type || ""
		this.name = name || ""
		this.text = unescapeHTML(text || "")
		this.zones = zones || []
		this.traits = traits || []  // new for each, unlike in Python
		this.kw_eob = []
		this.kw_eot = []
		this.link = link || ""
		this.ap = parseInt(ap) || 0
		this.ap_eob = 0
		this.ap_eot = 0
		this.hp_eob = 0
		this.hp_eot = 0
		this.hp = parseInt(hp) || 0
		this.damage = 0
		this.rested = false
		this.sick = false
		this.stunned = false
	}
	LEVEL() {
		let rv = this.level
		let t = this.text + (this.pilot && this.pilot.text || "")
		const en = (this.owner === p1 ? p2 : p1)
		if (this.owner.hand.includes(this)) {
			if (inStr(t, "While an enemy player has 7 or more cards in their trash, this card in your hand gets Lv. -3 and cost -3.") && en.trash.lenth >= 7) rv -= 3
			if (this.text === "While you have no Units that are Lv.6 or higher in play, this card in your hand gets Lv. -1 and cost -1 for each enemy Unit in play." && !this.owner.battle.some(c => c.level >= 6)) {
				rv -= (this.owner === p1 ? p2 : p1).battle.length
			}
			if (inStr(this.text, "When playing this card from your hand, you may discard 1 (G Generation) Unit card. If you do, play this card as if it has 2 Lv. and cost.") && this.owner.hand.some(c => c !== this && c.type === "UNIT" && c.hasTrait("G Generation"))) return 2
		}
		// TODO: Level and cost stick on the battlefield
		//if (inStr(this.text, "When playing this card from your hand, you may discard 1 (G Generation) Unit card. If you do, play this card as if it has 2 Lv. and cost.") && this.kws_eoz.includes("level 2")) return 2
		return rv
	}
	COST() {
		let rv = this.cost
		let t = this.text + (this.pilot && this.pilot.text || "")
		const en = (this.owner === p1 ? p2 : p1)
		if (this.owner.hand.includes(this)) {
			if (t === "During a turn where your opponent has discarded due to one of your effects, this card in your hand gets cost -2." && en.kw_eot.includes("discard_by_effect_of_p" + this.owner.pid)) rv -= 2
			if (inStr(t, "While an enemy player has 7 or more cards in their trash, this card in your hand gets Lv. -3 and cost -3.") && en.trash.lenth >= 7) rv -= 3
			if (this.text === "Reduce the cost of this card in your hand by an amount equal to the number of (UN)/(Superpower Bloc) Command cards in your trash.") {
				rv -= this.owner.trash.filter(c => c.type === "COMMAND" && c.hasTrait("UN") || c.hasTrait("Superpower Bloc")).length
			}
			if (this.text === "While you have a (CB) Link Unit in play, this card in your hand gets cost -1." && this.owner.battle.some(c => c.hasTrait("CB") && c.linked())) {
				rv -= 1
			}
			if (this.text === "While you have 2 or more (Titans) Units in play, this card in your hand gets cost -1." && this.owner.battle.filter(c => c.hasTrait("Titans")).length >= 2) {
				rv -= 1
			}
			if (this.text === "While you have 2 or more (Earth Federation) Units in play, this card in your hand gets cost -1." && this.owner.battle.filter(c => c.hasTrait("Earth Federation")).length >= 2) {
				rv -= 1
			}
			if (this.text === "While you have 2 or more (Superpower Bloc)/(UN) Units in play, this card in your hand gets cost -1." && this.owner.battle.filter(c => c.hasTrait("Superpower Bloc") || c.hasTrait("UN")).length >= 2) {
				rv -= 1
			}
			if (this.text === "While you have no Units that are Lv.6 or higher in play, this card in your hand gets Lv. -1 and cost -1 for each enemy Unit in play." && !this.owner.battle.some(c => c.level >= 6)) {
				rv -= (this.owner === p1 ? p2 : p1).battle.length
			}
			if (inStr(this.text, "When playing this card from your hand, you may discard 1 (G Generation) Unit card. If you do, play this card as if it has 2 Lv. and cost.") && this.owner.hand.some(c => c !== this && c.type === "UNIT" && c.hasTrait("G Generation"))) return 2
		} else if (this.owner.trash.includes(this)) {
			if (this.text === "This card in your trash gets cost -1.") {
				rv -= 1
			}
		}
		return Math.max(0, rv)
	}
	AP() {
		let rv = this.ap + this.ap_eob + this.ap_eot
		let t = this.text + (this.pilot && this.pilot.text || "")
		const en = (this.owner === p1 ? p2 : p1)

		if (inStr(t, "Increase this Unit's AP by an amount equal to the number of (Cyclops Team) Pilot cards/Command cards with unique names in your trash.")) {
			rv += new Set(this.owner.trash.filter(c => ["COMMAND", "PILOT"].includes(c.type) && c.traits.includes("Cyclops Team"))).size
		}
		if (this.owner.resource.length >= 7 && inStr(t, "While you are Lv.7 or higher, this Unit gets AP+2.")) rv += 2
		if (this.damage > 0 && inStr(t, "While this Unit is damaged, it gets AP+2.")) {
			rv += 2
		}
		if (this.pilot) {
			rv += this.pilot.ap
			if (inStr(t, "[During Pair･Red Pilot]This Unit gets AP+2.") && this.pilot.color === "RED") rv += 2
			if (this.linked()) {
				if (inStr(t, "[During Link] This Unit gets AP+2.")) rv += 2
				if (inStr(t, "[During Link] This Unit gets AP+2 during your turn.") && active_player == this.owner) rv += 2
				if (inStr(t, "[During Link] This Unit gets AP+1 and HP+1.")) rv += 1
			}
		}
		if (inStr(t, "While an enemy player has 7 or more cards in their trash, this Unit gets AP+1 and HP+1.") && en.trash.lenth >= 7) rv += 1
		if (inStr(t, "While this Unit has <Repair>, it gets AP+1.") && this.getRepair() > 0) rv += 1
		if (inStr(t, "While you have another (Titans) Unit in play, this gets AP+1.") && this.owner.battle.some(c => c !== this && c.hasTrait("Titans"))) rv += 1
		if (inStr(t, "While you have another (Triple Ship Alliance) Unit in play, this Unit gets AP+1 and <Blocker>.") && this.owner.battle.some(c => c !== this && c.hasTrait("Triple Ship Alliance"))) rv += 1
		if (inStr(t, "While you have another Unit with <High-Maneuver> in play, this Unit gets AP+1.") && this.owner.battle.some(c => c !== this && c.hasKw("High-Maneuver"))) rv += 1
		if (inStr(t, "While there is a friendly white Base in play, this Unit gets AP+2.") && this.owner.base && this.owner.base.color === "WHITE") rv += 2
		if (inStr(t, "While no enemy Base is in play, this Unit gets AP+1.") && !en.base) rv += 1
		if (inStr(t, "While you have another (Jupitris) Unit in play, this Unit gets AP+1 and <Repair 1>.") && this.owner.battle.some(c => c !== this && c.hasTrait("Jupitris"))) rv += 1
		if (t === "During your turn, while you have a (CB) Pilot in play, this Unit gets AP+2." && active_player === this.owner && this.owner.battle.some(c => c.pilot && c.pilot.hasTrait("CB"))) rv += 2
		if (inStr(t, "[During Link]This Unit gets AP+2 for each of your rested (CB) Units.") && this.linked()) rv += this.owner.battle.filter(c => c.rested && c.hasTrait("CB")).length * 2
		if (inStr(t, "While you have a Unit token in play, this Unit gets AP+1.") && this.owner.battle.some(c => c.isToken())) rv += 1
		if (active_player === this.owner && this.isUnit()) {
			rv += this.owner.battle.filter(c => c.pilot && inStr(c.text, "[During Pair]During your turn, all your Units get AP+1.")).length
		}
		if (active_player !== this.owner && this.isToken()) {
			// "Friendly" instead of "your" implies team base counts too.
			rv += this.owner.battle.filter(c => inStr(c.text, "All friendly Unit tokens get AP+1 during your opponent's turn.")).length
		}
		if (inStr(t, "While there are 4 or more Command cards in your trash, this Unit gets AP+1 and HP+1.") && this.owner.trash.filter(c => c.type === "COMMAND").length >= 4) {
			rv += 1
		}

		// bonus from other units
		for (const c of this.owner.battle) {
			t = c.text + (c.pilot && c.pilot.text || "")
			if (active_player === this.owner) {
				if (c.pilot) {
					if (inStr(t, "[During Pair]During your turn, all your Units get AP+1.")) rv += 1

					if (c.pilot.hasTrait("ZAFT") && this.type === "UNIT" && this.hasTrait("ZAFT") && inStr(t, "[During Pair･(ZAFT) Pilot]During your turn, all your (ZAFT) Units get AP+2.")) rv += 2
				}
				if (this.owner.trash.length >= 7 && c !== this && this.hasTrait("Vulture") && inStr(t, "[During Link]During your turn, while there are 7 or more cards in your trash, all your other (Vulture) Units get AP+2.") && c.linked()) rv += 2
			}
		}
		return rv
	}
	HP() {
		let rv = this.hp
		const t = this.text + (this.pilot && this.pilot.text || "")
		const en = (this.owner === p1 ? p2 : p1)
		if (this.pilot) {
			rv += this.pilot.hp
			if (this.linked()) {
				if (inStr(t, "[During Link]This Unit gets AP+1 and HP+1.")
					|| inStr(t, "[During Link]This Unit gets HP+1.")) {
					rv += 1
				}
			}
		}
		if (inStr(t, "While an enemy player has 7 or more cards in their trash, this Unit gets AP+1 and HP+1.") && en.trash.lenth >= 7) rv += 1
		if (inStr(t, "While there are 4 or more Command cards in your trash, this Unit gets AP+1 and HP+1.") && this.owner.trash.filter(c => c.type === "COMMAND").length >= 4) {
			rv += 1
		}
		return rv - this.damage
	}
	canDamage(def) {
		const t = def.text + (def.pilot && def.pilot.text || "")
		
		if (active_player === def.owner) {
			if (inStr(t, "During your turn, this Unit can't receive battle damage from enemy Units that are Lv.2 or lower.") && this.isUnit() && this.LEVEL() <= 2) return false

			if (inStr(t, "During your turn, while this Unit has <Breach>, it can't receive battle damage from enemy Units with 3 or less AP.") && def.getBreach() && this.isUnit() && this.AP() <= 3) return false

			if (inStr(t, "During your turn, while you have a (CB) Link Unit in play, this Unit can't receive battle damage from enemy Units with 3 or less AP.") && this.isUnit() && this.AP() <= 3 && def.owner.battle.some(c => c.hasTrait("CB") && c.linked())) return false
		}
		if (def.facedown && def.owner.battle.some(c => c.text === "While this Unit is rested, friendly Shields can't receive battle damage from enemy Units.")) return false

		if ((def.facedown || def === def.owner.base) && this.LEVEL() <= 4 && def.owner.kw_eob.includes(`noDmgShield enemy.unit.lv${this.LEVEL()}min`)) return false

		if (inStr(t, "While you have a rested (Zeon) Unit in play, this Base can't receive battle damage from enemy Units that are Lv.4 or lower.") && this.level <= 4 && def.owner.battle.some(c => c.rested && c.hasTrait("Zeon"))) return false

		if (def.kw_eob.some(txt => txt.match(new RegExp(`noDmg enemy.unit.ap[${this.level}-9]min`)))) return false
		if (def.kw_eob.some(txt => txt.match(new RegExp(`noDmg enemy.unit.hp[${this.level}-9]min`)))) return false
		if (def.kw_eob.some(txt => txt.match(new RegExp(`noDmg enemy.unit.lv[${this.level}-9]min`)))) return false
		if (def.kw_eot.some(txt => txt.match(new RegExp(`noDmg enemy.unit.ap[${this.level}-9]min`)))) return false
		if (def.kw_eot.some(txt => txt.match(new RegExp(`noDmg enemy.unit.hp[${this.level}-9]min`)))) return false
		if (def.kw_eot.some(txt => txt.match(new RegExp(`noDmg enemy.unit.lv[${this.level}-9]min`)))) return false
		return true
	}
	linked() {
		return (this.pilot && linksWith(this, this.pilot)) || (this.unit && linksWith(this.unit, this))
	}
	async recover(number = 1) {
		if (this.damage < 1 || number < 1) return false
		log("🛠️Recover " + number + " " + this)
		this.damage -= parseInt(number)
		if (this.damage < 0) this.damage = 0
		const t = this.text + (this.pilot && this.pilot.text || "")
		const rule = "[During Link][Once per Turn]During your turn, when this Unit recovers HP, if you have 4 or less cards in your hand, draw 1."
		if (inStr(t, rule) && this.linked() && !once_per_turn.includes(rule + this.cid) && this.owner.hand.length <= 4) {
			once_per_turn.push(rule + this.cid)
			await this.owner.draw()
		}
		return true
	}
	toString(simple = false) {
		let rv = simple ? "" : (this.type === "COMMAND" || inStr(this.type, "RESOURCE")) ? `#${this.cid} ` : `${this.AP()}/${this.HP()} #${this.cid} ${this.id} `
		if (this.type === "COMMAND" && this.unit) return rv + getPilotName(this)
		if (this.type === "PILOT" && simple) return getPilotName(this)
		let pilot_name = ""
		if (this.pilot) pilot_name = getPilotName(this.pilot)
		return rv + `${this.name}${pilot_name ? " & " + pilot_name : ""}`
	}
	toDict() {
		return {
			"id": this.id,
			"color": this.color,
			"level": this.level,
			"cost": this.cost,
			"type": this.type,
			"name": this.name,
			"text": this.text,
			"zones": this.zones,
			"traits": this.traits,
			"link": this.link,
			"ap": this.ap,
			"hp": this.hp,
		}
	}
	static fromDict(d) {
		// log("Returning new card from dict " + JSON.stringify(d))
		return new Card(d.type, d.name, d.ap, d.hp, d.level, d.cost, d.text, d.zones, d.traits, d.link, d.id, d.color)
	}
	toHTML(left, top, classes = "", z = 0, raw = false) {
		const id = this.id.split("_")[0]
		if (classes === "facedown") return `<div id="c${this.cid}" class="card${this.rested ? " rested" : ""} facedown${inStr(this.type, "RESOURCE") ? " resource" : ""}" style="z-index:${z}; left:${left}vmin; top:${top}vmin; border-color: black; background-color: white;" onclick='zoom(this)'></div>`

		if (raw) return `<div id="c${this.cid}" class="card${this.rested ? " rested" : ""}${classes ? " " + classes : ""}${this.type === "RESOURCE" ? " resource" : ""}" style="z-index:${z}; left:${left}vmin; top:${top}vmin; border-color:var(--${this.color}); background-color:var(--${this.color});background-image:url(https://exburst.dev/gundam/cards/sd/${id}.webp); font-size: 1vmin; text-shadow: #000 0 0 1px" onclick='zoom(this)'><div class="pricecheck" onclick="window.open(\`https://kaiofcards.com/search?q=${escapeHTML(encodeURIComponent(this.name))}\`, '_blank'); event.stopPropagation();"></div>${this.level} ${this.id}<br>${this.cost}<div style="font-size:0.5vmin"><b>${escapeHTML(this.name)}</b><br>${this.traits}<br>${escapeHTML(this.text).replaceAll("\n", "<br>")}</div>${this.link.length > 1 ? this.link : ""} ${this.ap || this.hp ? "" + this.ap + " " + this.hp : ""}</div>`

		return `<div id="c${this.cid}" class="card${this.rested ? " rested" : ""}${classes ? " " + classes : ""}${this.type === "RESOURCE" ? " resource" : ""}" style="z-index:${z}; left:${left}vmin; top:${top}vmin; border-color:var(--${this.color}); background-color:var(--${this.color}); background-image:url(https://exburst.dev/gundam/cards/sd/${id}.webp);" onclick="zoom(this)" oncontextmenu="if (this.classList.contains('glow')) { event.preventDefault(); chosen = this.id; }"><div class="pricecheck" onclick="window.open(\`https://kaiofcards.com/search?q=${escapeHTML(encodeURIComponent(this.name))}\`, '_blank'); event.stopPropagation();"></div>${this.cid} ${this.damage ? '<div style="color: red">' + this.damage + " DMG</div>" : ""} ${this.sick ? '<div style="color: red">not ready</div>' : ""}${(this.AP() !== 0 || this.HP() !== 0) ? this.AP() + "/" + this.HP() : ""}</div>`
	}

	isUnit() {
		return inStr(this.type, "UNIT")
	}

	isToken() {
		return inStr(this.type, "TOKEN")
	}

	/** hasKw checks if this card has a Keyword of Blocker|Breach|First Strike|High-Maneuver|Repair|Support|Suppression
	 * Note that Support is also a Trait.
	 */
	hasKw(kw) {
		const en = (this.owner === p1 ? p2 : p1)
		if (kw === "protection.enemy.units" && this.facedown && this.owner.battle.filter(c => c.rested && inStr(c.text, "While this Unit is rested, friendly Shields can't receive battle damage from enemy Units.")).length > 0) {
			return true
		}
		let t = this.text
		if (this.pilot && this.pilot.type === "PILOT") {  // COMMANDs lack PILOT abilities.
			t += "\n" + this.pilot.text
		}
		const myturn = (active_player === this.owner)
		if (kw === "Blocker") {
			let mo = null
			if (t.indexOf("<Blocker>") === 0) return true
			if (inStr(t, "If there are 2 or more enemy players, this Unit gains <Blocker>.")) return false
			if (inStr(t, "While you have a (CB) Pilot in play, this Unit gains <Blocker>.")) {
				if (this.owner.battle.some(c => c.pilot && c.pilot.hasTrait("CB"))) return true
			}
			if (mo = t.match(/^While you have another \(([^)]+)\) Unit in play, this Unit g[^.]+? <Blocker>.$/)) {
				if (this.owner.battle.some(c => c !== this && c.hasTrait(mo[1]))) return true
			}
			if (mo = t.match(/^While (\d) or more enemy Units are in play, this Unit gains <Blocker>.$/)) if (en.battle.length >= mo[1]) return true
			if (inStr(t, "While a friendly Base is in play, this Unit gains <Blocker>.") && this.owner.base) return true
			if (inStr(t, "While this Unit has 5 or more AP, it gains <Blocker>.") && this.AP() >= 5) return true
			if (inStr(t, "While this Unit is (Neo Zeon), it gains <Blocker>.") && this.hasTrait("Neo Zeon")) return true
			if (inStr(t, "While this Unit is white, it gains <Blocker>.") && this.color === "WHITE") return true
			if (this.pilot && inStr(t, "[During Pair]While there are 4 or more Command cards in your trash, this Unit gains <Blocker>.") && this.owner.trash.filter(c => c.type === "COMMAND").length >= 4) return true

			if (this.owner.battle.some(c => c.rested && inStr(c.text, "While this Unit is rested, all your (League Militaire) Unit tokens gain <Blocker>.")) && this.hasTrait("League Militaire") && this.isUnit() && this.isToken()) return true
		}
		if (kw === "Breach") return this.getBreach() > 0
		if (kw === "First Strike") {
			if (myturn && inStr(t, "[During Link]During your turn, while this Unit is battling an enemy Unit with a [Destroyed] effect, it gains <First Strike>.") && this.linked() && defender && defender.isUnit() && inStr(defender.text + (defender.pilot ? defender.pilot.text : ""), "[Destroyed]")) return true
			if (this.owner.resource.length >= 7 && inStr(t, "[During Link]While you are Lv.7 or higher, this Unit gains <First Strike>.") && this.linked()) return true
			if (myturn && this.isUnit() && defender && inStr(defender.text, "During your opponent's turn, the enemy Unit battling this Unit gains <First Strike>.")) return true
			if (myturn && inStr(t, "During your turn, while this Unit is battling an enemy Unit that is Lv.2 or lower, it gains <First Strike>.") && defender && defender.level <= 2 && defender.isUnit()) return true
			if (inStr(t, "While you have a red (Super Soldier) Pilot in play, this Unit gains <First Strike>.") && this.owner.battle.some(c => c.pilot && c.pilot.color === "RED" && c.pilot.hasTrait("Super Soldier"))) return true
		}
		if (kw === "High-Maneuver") {
			if (inStr(t, "[During Pair]This Unit gains <High-Maneuver>.") && this.pilot) return true
			if (inStr(t, "[During Link]This Unit gains <High-Maneuver>.") && this.linked()) return true
			if (inStr(t, "While this Unit is (Academy), it gains <High-Maneuver>.") && this.hasTrait("Academy")) return true
		}
		if (kw === "Repair") return this.getRepair() > 0
		if (kw === "Support") {
			if (t.indexOf("[Activate･Main]<Support ") === 0) return true
		}
		if (kw === "Suppression") {
			if (t.match(/^<Suppression>/)) return true
			if (inStr(t, "[During Link]This Unit gains <Suppression>.") && this.linked()) return true
			if (inStr(t, "While a friendly Base in play, this Unit gains <Suppression>.") && this.owner.base) return true
			if (inStr(t, "While a friendly (G Generation) Unit with <Blocker> is in play, this Unit gains <Suppression>.") && this.owner.battle.some(c => c.hasTrait("G Generation") && c.hasKw("Blocker"))) return true
			if (inStr(t, "While a rested enemy Unit is in play, this Unit gains <Suppression>.") && en.battle.some(c => c.rested)) return true
			if (inStr(t, "While this is damaged, it gains <Suppression>.")) return this.damage > 0

		}

		// Find missing rules.
		// if (!this.traits.concat(this.kw_eot).includes(kw) && new RegExp("While .*?"+kw).exec(t)) {
		// 	log("🚩FIXME kw " + kw + " of " + this + " " + this.text + (this.pilot? " + " + this.pilot.text : ""))
		// }

		this.kw_eot.concat(this.kw_eob).includes(kw)
	}

	hasTrait(trait) {
		return this.traits.includes(trait)
	}

	getBreach() {
		let rv = (this.text + this.kw_eot).matchAll(/(?<!gains? <)Breach (\d)/g).map(mo => parseInt(mo[1])).reduce((tot, a) => tot + a, 0)

		if (this.isToken()) rv += this.owner.battle.filter(c => inStr(c.text, "All your Unit tokens gain <Breach 1>.")).length
		const t = this.text + (this.pilot && this.pilot.text || "")
		if (inStr(t, "[Attack]If you are attacking a damaged enemy Unit, this Unit gains <Breach 3> during this battle.") && defender && defender.daamge > 0 && defender.type !== "BASE") rv += 3
		if (inStr(t, "[During Link]This Unit gains <Breach 3>.") && this.linked()) rv += 3
		if (inStr(t, "[During Pair]This Unit gains <Breach 3>.") && this.pilot) rv += 3
		if (inStr(t, "[During Link]If this is an (AGE System) Unit, it gets AP+1 and <Breach 1>.") && this.hasTrait("AGE System") && this.linked()) rv += 1
		if (inStr(t, "While another friendly (Zeon) Link Unit is in play, this Unit gains <Breach 5>.") && this.owner.battle.some(c => c !== this && c.hasTrait("Zeon") && c.linked())) rv += 5
		if (inStr(t, "While this Unit has 5 or more AP, it gains <Breach 3>.") && this.HP() >= 5) rv += 3
		if (inStr(t, "While this Unit is (Zeon), it gains <Breach 1>.") && this.hasTrait("Zeon")) rv += 1
		if (inStr(t, "While you have a green (Super Soldier) Pilot in play, this Unit gains <Breach 3>.") && this.owner.battle.some(c => c.pilot && c.pilot.color === "GREEN" && c.pilot.hasTrait("Super Soldier"))) rv += 3

		return rv
	}

	getRepair() {
		let rv = (this.text + this.kw_eot).matchAll(/(?<!gains? <)Repair (\d)/g).map(mo => parseInt(mo[1])).reduce((tot, a) => tot + a, 0)
		const t = this.text + (this.pilot && this.pilot.text || "")
		if (inStr(t, "[During Link]This Unit gains <Repair 2>") && this.linked()) rv += 2
		if (inStr(t, "[During Pair]This Unit gains <Repair 2>") && this.pilot) rv += 2
		if (inStr(t, "This Unit gains the same number of <Repair 1> as the number of (Calamity War) Unit tokens you have in play.")) {
			rv += this.owner.battle.filter(c => c.isToken() && c.hasTrait("Calamity War")).length
		}
		if (inStr(t, "While a friendly white Base is in play, this Unit gains <Repair 1>.") && this.owner.base && this.owner.base.color === "WHITE") rv += 1
		if (inStr(t, "While this Unit is blue, it gains <Repair 1>.") && this.color === "BLUE") rv += 1
		if (inStr(t, "While this Unit has 1 HP, it gains <Repair 3>.") && this.HP() === 1) rv += 3
		if (inStr(t, "While you have another (Jupitris) Unit in play, this Unit gets AP+1 and <Repair 1>.") && this.owner.battle.some(c => c !== this && c.hasTrait("Jupitris"))) rv += 1
		return rv
	}
}

// let response = await fetch("cards.json")
// const DECKS = await response.json() // No multiline strings
import { DECKS } from "./decks.js"
let decks = DECKS.slice()

function addCustomDeck() {
	decks = DECKS.slice()
	let p1v = p1deck.value || -1
	let p2v = p2deck.value || -1
	let mutantDeck = localStorage.getItem("mutantDeck")
	if (mutantDeck) decks.push(mutantDeck)
	for (let slot of ["", "1", "2", "3"]) {
		let customDeck = localStorage.getItem("customDeck" + slot)
		if (customDeck) decks.push(customDeck)
	}
	let deck_options = `<option value="-1">Random</option>`
	for (let i = 0; i < decks.length; ++i) {
		deck_options += `<option value="${i}">${decks[i].split("\n")[0].slice(2)}</option>`
	}
	p1deck.innerHTML = deck_options
	p1deck.value = p1v
	p2deck.innerHTML = deck_options
	p2deck.value = p2v
}
addCustomDeck()

function saveCustomDeck(deck, slot = "1") {
	if (!confirm(`Save as your custom${slot} deck?`)) return
	localStorage.setItem("customDeck" + slot, `# Custom deck ${slot}\n` + deck)
	addCustomDeck()
}

// card id on the battlefield, link to render element
let cid = 0

// https://bost.ocks.org/mike/shuffle/compare.html
function shuffle(array) {
	let m = array.length, t, i
	while (m) {
		i = Math.floor(Math.random() * m--)
		t = array[m]
		array[m] = array[i]
		array[i] = t
	}
}

let pid = 0
class Player {
	loadDeck(decklist) {
		let [fulldeck, alerts, deckname] = parseDecklist(decklist, true, this)
		this.deckname = deckname
		// To draw from
		this.deck = fulldeck
		// Copy for viewing
		this.fulldeck = fulldeck.filter(c => true)
		shuffle(this.deck)
		log(`🎴${this.name} deck: <a href="#" onclick='showDeck(\"${escapeHTML(this.deckname)}\"); event.preventDefault()'>${this.deckname}</a>`, false)
	}

	constructor(name) {
		this.pid = ++pid
		this.name = name
		this.hand = []
		let deck = null
		if (pid === 1) deck = p1deck.value < 0 ? decks[rnd(0, decks.length - 1)] : decks[p1deck.value]
		if (pid === 2) deck = p2deck.value < 0 ? decks[rnd(0, decks.length - 1)] : decks[p2deck.value]
		this.loadDeck(deck)
		if (this.deck.length < 1) {
			log(`🚩FIXME: Empty deck ${deck}`, true, true)
		}
		// Maybe still useful for fuzzing.
		// for (let i = 0; i < 50; ++i) {
		// 	const t = Type[rnd(1, 4)]
		// 	this.deck.push(new Card(t, t+i, rnd(1, 5), rnd(1, 5), rnd(1, 7), rnd(1, 5), "", "", "ST04-008_PR", "RED"))
		// }
		this.resource_deck = []
		for (let i = 0; i < 10; ++i) {
			// R-003 is hard to count while rested
			this.resource_deck.push(this.getCard("R-00" + rnd(4, 9)))
		}
		this.battle = []
		this.shield = []
		this.base = this.getCard("EXB-001")  // new Card("BASE", "EX Base", 0, 3)
		this.resource = []
		this.trash = []
		this.kw_eob = []
		this.kw_eot = []

		// Opening hand
		// await this.draw(5, false) doesn't work so just DIY
		let cards = this.deck.slice(-5)
		this.hand = this.hand.concat(cards)
		this.deck = this.deck.slice(0, -5)
		// Shields
		for (let i = 0; i < 6; ++i) {
			const c = this.deck.pop()
			c.rested = true
			this.shield.push(c)
		}
	}

	async breakShield(source, with_damage = true, with_battle_damage = false) {
		const c = this.shield.pop()
		if (!c) return false
		log(`💥Broke shield ${this.shield.length + 1}: ${c}`)
		await activate(c)
		await boom.play().catch(ex => { })
		let toTrash = true
		let t = /Burst\]([^.]+)/.exec(c.text)
		if (t) {
			t = t[1]
			await run(c, "Burst")
			toTrash = !(inStr(t, "Add this card to your hand") || inStr(t, "Deploy this card"))
		}
		if (toTrash) {
			// log("🗑️Trash " + c)
			trash(c)
		}
		await publish(" destroys an enemy shield ", source.owner.battle, {
			source: source,
			with_battle_damage: with_battle_damage,
			with_damage: with_damage
		})
		await render()
		await sleep(1000)
		return true
	}

	canUse(c) {
		return (c.LEVEL() < this.resource.length && c.COST() < this.resource.length) &&
			((c.type === "BASE" && !this.base)
				|| (c.type === "UNIT" && this.battle.length < 6)
				|| (c.type === "PILOT" && this.battle.some(c2 => !c2.pilot && linksWith(c, c2)))
			)
	}

	async deploy(ctx, card) {
		if (card.type === "BASE") {
			if (this.base) {
				log("🗑️Replace " + this.base)
				trash(this.base)
			}
			log("🏰Base " + card)
			card.rested = false
			this.base = card
		} else {
			if (card.type.indexOf("UNIT") < 0) throw Error("Not a unit: " + card)
			if (this.battle.length >= 6) {
				const weakest = mySort(this.battle, c => c.AP())[0]
				/* 5-10-4. A card placed into the trash by rules management when the limit on the
				number of cards in the battle area or base section is exceeded is not treated
				as destroyed. (See 11. Rules Management) */
				// await destroy(weakest, ctx, false)
				log("🗑️Replace " + weakest)
				this.battle = this.battle.filter(c => c !== weakest)
				if (weakest.pilot) trash(weakest.pilot)
				// tokens don't go to trash
				if (weakest.type.indexOf("TOKEN") < 0 && weakest.type.indexOf("EX") !== 0) trash(weakest)
				if (delay === 0) return true
				await render()
				await sleep(500)
				return true
			}
			if (card.LEVEL() <= 3 && card.type === "UNIT" && p1.battle.concat(p2.battle).some(c => inStr(c.text, "All Units that are Lv.3 or lower other than Unit tokens are deployed rested.") && c.linked())) card.rested = true
			log(`🚀Deploy ${card.rested ? "rested " : ""}${card}`)
			card.sick = true
			card.damage = 0
			this.battle.push(card)
			this.kw_eot.push("Deployed " + card.traits)
		}
		await render()
		await run(card, "Deploy", "", ctx)
	}

	async deployFromHand(ctx, card) {
		this.hand = this.hand.filter(c => c !== card)
		card.from_trash = false
		await this.deploy(ctx, card)
	}

	async deployFromTrash(ctx, card) {
		this.trash = this.trash.filter(c => c !== card)
		card.from_trash = true
		await this.deploy(ctx, card)
		card.from_trash = false
	}

	async deployToken(ctx, name, rested = false) {
		let token = this.getToken(name)
		token.rested = !!rested
		await this.deploy(ctx, token)
	}

	async draw(number = 1, effect = true) {
		if (effect) await publish("When you draw with an effect, ", active_player.battle)
		number = parseInt(number)
		log("🎴" + this.name + " draw " + number)
		for (let i = 0; i < number; ++i) {
			if (this.deck.length < 1) {
				let msg = `💀${this.name} lost by empty deck ${this.deckname} (vs ${(this === p1 ? p2 : p1).deckname})`
				log(msg)
				endGame(this === p1 ? p2 : p1)
				throw Error(msg)
			}
			this.hand.push(this.deck.pop())
		}
	}

	async discard(ctx, number = 1, targets = null, optional = false) {
		number = parseInt(number)
		// if (targets) number = targets.length
		if (!targets) targets = [...this.hand]
		let discarded = []
		let ai = (active_player === p1 ? p1ai.checked : p2ai.checked)
		for (let i = 0; i < number; ++i) {
			const c = ai && rndPick(this.hand.filter(c => targets.includes(c))) || !ai && await chooseCard(this.hand)
			if (!c) return discarded
			discarded.push(c)
			log("🗑️" + this.name + " discard " + c)
			this.hand = this.hand.filter(item => item !== c)
			trash(c)
		}
		if (discarded.length > 0 && ctx.running_card) discarded[0].owner.kw_eot.push("discard_by_effect_of_p" + ctx.running_card.owner.pid)
		return discarded
	}

	getCard(id) {
		const d = CARDS[id]
		if (!d) {
			const msg = `Card not found: ${id}. Hard reload (Ctrl+Shift+R) this page to update the database. NOTE: Might lose custom/mutant decks, or that was due to Chromium's tantrum when disk space was low.`
			log(msg)
			throw Error(msg)
		}
		const rv = Card.fromDict(d)
		// DeckPlanet bug workarounds. See also cards.json.
		rv.text = rv.text.replaceAll(/<br ?\/?>/g, "\n").replaceAll("[action]", "[Action]").replaceAll("[br]", "\n").replaceAll("[burst]", "[Burst]").replaceAll("[breach 3]", "[Breach 3]").replaceAll("[deploy]", "[Deploy]").replaceAll("[main]", "[Main]").replaceAll("[pilot]", "[Pilot]").replaceAll("[when paired]", "[When Paired]").replaceAll(/\[(Blocker|Breach|First Strike|High-Maneuver|Repair|Support|Suppression)\]/g, "<$1>").replaceAll(/\[(\w+) (\d)\]/g, "<$1 $2>").replaceAll("white Base Team", "White Base Team")
		rv.link = rv.link.replaceAll(" / ", "/")
		cid += 1
		rv.cid = cid
		rv.owner = this
		return rv
	}

	getPairableUnits() {
		return this.battle.filter(c => !c.pilot && !inStr(c.text, "This Unit can't be paired with a Pilot."))
	}

	getProne(att) {
		let prone = this.battle.filter(bc => bc.rested)
		if (att.kw_eot.includes("canAttack active.unit.Blocker")) {
			const extra = this.battle.filter(bc => !bc.rested && bc.hasKw("Blocker"))
			if (extra) prone = extra.concat(prone)
		}
		if (att.kw_eot.includes("canAttack active.unit.damaged")) {
			const extra = this.battle.filter(bc => !bc.rested && bc.damage > 0)
			if (extra) prone = extra.concat(prone)
		}
		if (att.kw_eot.includes("canAttack active.unit.apEqmin")) {
			const extra = this.battle.filter(bc => !bc.rested && bc.ap <= att.ap)
			if (extra) prone = extra.concat(prone)
		}
		for (let i = 0; i <= 9; ++i) {
			if (att.kw_eot.includes(`canAttack active.unit.ap${i}min`)) {
				const extra = this.battle.filter(bc => !bc.rested && bc.AP() <= i)
				if (extra) prone = extra.concat(prone)
			}
			if (att.kw_eot.includes(`canAttack active.unit.lv${i}min`)
				|| inStr(att.text, "This Unit may choose an active enemy Unit that is Lv." + i + " or lower as its attack target.")) {
				const extra = this.battle.filter(bc => !bc.rested && bc.level <= i)
				if (extra) prone = extra.concat(prone)
			}
		}
		if (att.kw_eot.includes("canAttack active.unit.nopilot")) {
			const extra = this.battle.filter(bc => !bc.rested && !bc.pilot)
			if (extra) prone = extra.concat(prone)
		}
		if (att.text === "[During Pair･(Vulture) Pilot]If there are 7 or more cards in your trash, this Unit may choose an active enemy Unit with a keyword effect as its attack target." && att.pilot && att.pilot.hasTrait("Vulture") && att.owner.trash.length >= 7) {
			const extra = this.battle.filter(bc => {
				if (bc.rested) return false
				let mo = bc.text.match(/(?<!with )<(\w+)/)
				return mo && bc.hasKw(mo[1])
			})
			if (extra) prone = extra.concat(prone)
		}
		return mySort(prone, def => -def.HP())
	}

	getToken(name) {
		// Yes, names are not unique.
		for (const k in CARDS) if (CARDS[k].name === name && inStr(CARDS[k].type, "TOKEN")) return this.getCard(k)
	}

	mill(number = 1) {
		const top = this.deck.slice(-number)
		log("🗑️Mill " + top)
		this.deck = this.deck.slice(0, -number)
		this.trash = this.trash.concat(top)
		return top
	}

	async paid(cost, card, text = "") {
		if (spent.length > 0) log(`💲Expend ${spent.length} EX resource`)
		log(`💲${this.name} pay ${cost} for ${text ? text + " of " : ""}${card}`)
		await publish("hen you pay ", this.battle.concat(this.base), {
			active_unit: card,
			active_text: text,
			active_cost: cost
		})
	}

	/** Only log if payment won't be refunded! */
	async pay(cost, target, doLog = true, text = "") {
		spent = []
		cost = parseInt(cost)
		if (cost > this.resource.filter(r => !r.rested).length) return false
		let paid = 0
		// EX last
		for (const r of mySort(this.resource.filter(c => !c.rested), c => c.type.indexOf("EX"))) {
			rest(r)
			paid += 1
			if (inStr(r.type, "EX")) {
				spent.push(r)
				this.resource = this.resource.filter(item => item !== r)
				// Wait for rest animation and show gone.
				await sleep(300)
				await render()
			}
			if (paid >= cost) break
		}
		if (doLog) await this.paid(cost, target, text)
		return true
	}

	async placeEXResource(rested = false) {
		// 5 max; replace EX resource
		while (true) {
			let ex = mySort(this.resource.filter(c => inStr(c.name, "EX")), c => c.rested)
			if (ex.length < 5) break
			this.resource = this.resource.filter(c => c !== ex[0])
		}
		let r = this.getCard(rndPick(EX_RESOURCES))
		if (rested) r.rested = true
		this.resource.push()
		await render()
		await sleep(500)
		await publish("When you place an EX Resource, ", this.battle.concat(this.base))
	}

	usefulAttackers() {
		return mySort(this.battle.filter(c => !c.rested && !c.sick && c.AP() > 0 && !(inStr(c.text, "\nThis Unit can't attack while there are 6 or less cards in your trash.") && this.trash.length <= 6) && !(c.text === "This Unit can only attack during a turn when one of your (Superpower Bloc)/(UN) Units is deployed." && !this.kw_eot.some(kw => kw.match(/^Deployed .*(Superpower Bloc|UN)/)))), c => -c.AP())
	}
}

async function loadCards() {
	log("⏳Loading " + document.title, false, true)
	dstatus.innerText = document.title
	const response = await fetch("cards.json")
	CARDS = await response.json()
	if (Object.keys(CARDS).length > 1) {
		log(`Loaded ${Object.keys(CARDS).length} cards`)
		for (const k in CARDS) {
			const card = CARDS[k]
			if (card.cost < 1 && !card.id.match(/^[TRE]/)) {
				log("🚩🚩FIXME: Card cost < 1: " + card.id, false, true, true)
				// ORB let card_data = await fetch(`https://gundamcard.gg/cards/${card.id}/`)
			}
		}
	}
}

/** 937 cards with GD05 on 2026-07-26 */
async function loadNewCards() {
	localStorage.clear()
	let gameInfo = JSON.parse(localStorage.getItem("gameInfo"))
	if (!gameInfo) {
		log("Fetching game info")
		// gameInfo = await fetch('https://raw.githubusercontent.com/CTimmerman/cgs/refs/heads/master/Gundam/cgs.json').then((response) => response.json())
		const response = await fetch('https://raw.githubusercontent.com/CTimmerman/cgs/refs/heads/master/Gundam/cgs.json')
		gameInfo = await response.json()
		localStorage.setItem("gameInfo", JSON.stringify(gameInfo))
	}
	CARDS = {}
	let pages = 1
	let page = 0
	let data = JSON.parse(localStorage.getItem("data")) || []
	if (!data.length > 0) {
		do {
			++page
			const link = `${gameInfo.allCardsUrl}&page=${page}`
			log(`Loading ${link}`)
			const response = await fetch(link)
			const json = await response.json()
			pages = json.meta.page_count
			data = data.concat(json.data)
			await sleep(500)  // rate limit to be nice to server
		} while (page < pages)
		localStorage.setItem("data", JSON.stringify(data))
	}
	for (const card of data) {
		const id = card.card_number
		CARDS[id] = new Card(
			card.card_type,
			card.card_name,
			card.card_ap || card.card_ap_boost,
			card.card_hp || card.card_hp_boost,
			card.card_level,
			card.card_cost,
			card.card_text_unstyled.replaceAll("\\\\", "\\").replaceAll(/[\[<]br ?\/?[\]>]/g, "\n").replaceAll(/\[(Blocker|Breach|First Strike|High-Maneuver|Repair|Support|Suppression)\]/g, "<$1>").replaceAll(/\[(\w+) (\d)\]/g, "<$1 $2>").replace(/\n$/, "").replaceAll("white Base Team", "White Base Team"), // DeckPlanet bug workarounds.
			card.card_zones.filter(z => z !== "-"),
			card.card_traits,
			["", "-"].includes(card.card_link_requirement) ? "" : card.card_link_requirement.replaceAll(" / ", "/"),
			id,
			card.card_color).toDict()
	}
	log("Cards: " + Object.keys(CARDS).length)
	localStorage.setItem("cards", JSON.stringify(CARDS))
}

async function render() {
	if (delay === 0) return
	while (window.pause) await sleep(1000)
	let html = ""
	for (const p of [p1, p2]) {
		let x = 0
		let y = 0
		let top = 0
		let left = 0
		// Trash
		for (let i = 0; i < p.trash.length; ++i) {
			left = 2
			top = 18 - 0.1 * i
			if (p === p2) {
				left += 70
				top += 48.6
			}
			const c = p.trash[i]
			c.rested = false
			html += c.toHTML(left, top, "", p === p2 ? 2 : 1)
		}
		// Deck
		for (let i = 0; i < p.deck.length; ++i) {
			left = 2
			top = 33 - 0.1 * i
			if (p === p2) {
				left = 72
				top += 18.5
			}
			html += p.deck[i].toHTML(left, top, "facedown", 1)
		}
		// Resource Area
		for (const c of p.resource) {
			left = 2 + x * 5
			top = 2
			if (p === p2) {
				left += 26
				top += 80
			}
			html += c.toHTML(left, top)
			x += 1
		}
		for (let i = 0; i < p.resource_deck.length; ++i) {
			left = 57
			top = 2 - 0.1 * i
			if (p === p2) {
				left = 17
				top += 80
			}
			html += p.resource_deck[i].toHTML(left, top, "facedown")
		}
		// Shield Area
		// Shields
		y = 0
		for (const c of p.shield) {
			left = 70
			top = 1 + y
			if (p === p2) {
				left = 4
				top = 86 - y
			}
			html += c.toHTML(left, top, "facedown")
			y += 4
		}
		// Base
		if (p.base) {
			left = 72
			top = 33
			if (p === p2) {
				left = 1.9
				top = 51.3
			}
			html += p.base.toHTML(left, top)
		}
		// Battle Area
		x = 0
		y = 0
		for (const c of p.battle) {
			if (x === 3) {
				x = 0
				y += 0.9
			}
			left = 18 + x * 17
			top = 17 + y * 16.4
			if (p === p2) {
				left += 5
				top += 33
			}
			if (c.pilot) {
				c.pilot.rested = c.rested
				html += c.pilot.toHTML(left - 2, top + 3.5)
			}
			html += c.toHTML(left, top)
			x += 1
		}
		// Hand
		x = 0
		top = p === p2 ? 96 : -12
		for (const c of p.hand) {
			left = 8 + x * 8
			html += c.toHTML(left, top)
			x += 1
		}
	}
	battlefield.innerHTML = html
}

async function attackStep(att, def = null) {
	attacker = att
	defender = def
	const enemy = att.owner === p1 ? p2 : p1
	log("🔫" + att + " attack " + (def ? "" + def : enemy.name))
	rest(att)
	await sleep(500)
	await run(att, "Attack")
	await publish(" attacks", att.owner.battle, {source: att, target: def})

	// Block Step
	let blocked = false
	for (const bc of enemy.battle) {
		if (!bc.rested && bc.hasKw("Blocker") && !bc.hasKw("/Blocker") && !att.hasKw("High-Maneuver")) {
			// Don't block if...
			if (defender) {
				if (defender.HP() > attacker.AP() || defender.AP() >= attacker.HP()) continue
			}
			log(`🛡️${bc} blocks ${att}`)
			rest(bc)
			defender = bc
			await sleep(500)
			await run(att, "", "blocked")
			break
		}
	}

	// Action Step
	await actionStep()  // Peacful Timbre etc.

	// Player or shield
	if (!defender || defender.facedown) {
		if (enemy.shield.length < 1) {
			await battle(att, enemy.hand[0] || enemy.resource[0])
			log("💀" + enemy.name + " died")
			boom.playbackRate = 0.5
			await boom.play().catch(ex => { })
			await sleep(2000)
			boom.playbackRate = 1
			endGame(att.owner)
			await render()
			return
		} else {
			await battle(att, enemy.shield.slice(-1)[0])
			let sup = att.hasKw("Suppression")
			if (sup) {
				log("❌Suppression")
			}
			for (let i = 0; i < (sup ? 2 : 1); ++i) {
				await enemy.breakShield(att, true, true)
				await publish(" destroys an enemy card with battle damage, ", [att])
			}
		}
		return
	}
	// Action step before this to change defender!
	await doBattle(att, defender)
}

/** Give AP+n until end of battle. */
function eobAP(unit, amount = 1) {
	amount = parseInt(amount)
	log(`🎯AP${amount < 0 ? amount : "+" + amount} EOB ${unit}`)
	unit.ap_eob += amount
}
function eobHP(unit, amount = 1) {
	amount = parseInt(amount)
	log(`🎯DMG-${amount < 0 ? amount : "+" + amount} EOB ${unit}`)
	unit.hp_eob += amount
}
function eobKw(unit, kw) {
	log(`🎯+${kw} EOB ${unit}`)
	unit.kw_eob.push(kw)
}
function eotAP(unit, amount = 1) {
	amount = parseInt(amount)
	log(`🎯AP${amount < 0 ? amount : "+" + amount} EOT ${unit}`)
	unit.ap_eot += amount
}
function eotHP(unit, amount = 1) {
	amount = parseInt(amount)
	log(`🎯HP${amount < 0 ? amount : "+" + amount} EOT ${unit}`)
	unit.hp_eot += amount
}
function eotKw(unit, kw, note = true) {
	if (note) log(`🎯+${kw} EOT ${unit}`)
	unit.kw_eot.push(kw)
}

// https://www.gundam-gcg.com/en/pdf/comprehensiverules_en.pdf section 9.
// [Action] COMMAND cards and [Activate-Action] effects.
async function actionStep() {
	// log("Action step")
	await render()
	let p = active_player
	let pass = 0
	let ai = (p === p1 ? p1ai.checked : p2ai.checked)
	while (pass < 2) {
		p = (p === p1 ? p2 : p1)
		let level = p.resource.length
		let ran = false
		const targets = p.hand.filter(c => c.type === "COMMAND").concat(p.battle).concat(p.base)
		shuffle(targets)
		for (const c of targets) {
			if (!c) continue
			let t = c.text + (c.pilot ? c.pilot.text : "")
			let cost = c.COST()
			let refund = false
			if (c.type === "COMMAND") {
				if (c.LEVEL() > level || cost > level) continue
				if (await p.pay(cost, c, false)) {
					p.hand = p.hand.filter(item => item !== c)
					if (inStr(t, "Action") && (ai || confirm(`Action ${c}?`)) && await run(c, "Action")) {
						ran = true
						trash(c)
						await render()
						await p.paid(cost, c)  // log payment
						await publish("play and activate", p.battle, {active_card: c})
					} else {
						refund = true
					}
				}
			} else {
				if (inStr(t, "Activate･Action")) {
					if (ai) await run(c, "Activate･Action")
					else {
						c = await chooseCard([c])
						if (c) await run(c, "Activate･Action")
					}
				}
			}
			if (refund) {
				if (c.id === "ST10-014" && p.resource.length < cost) {
					log(`FIXME: Refunding ${c.id} cost ${cost} spent ${spent} r/res ${p.resource.filter(c => c.rested).length}/${p.resource.length}`, false, true, true)
					// debugger;
				}
				// No useful target, so don't play this and roll back payment.
				if (cost > 0) {
					let r = null
					while (r = spent.pop()) {
						r.rested = false
						p.resource.push(r)
						--cost
					}
					await render()
					for (let i = 0; i < cost; ++i) {
						r = p.resource[i]
						if (!r) throw Error(`spent: ${spent.length} cost: ${cost} i: ${i} does not exist?!`)
						await activate(r)
					}
				}
				p.hand.push(c)
			}
			spent = []
		}
		if (ran) pass = 0
		else pass += 1
	}
}

function getDamage(att, def) {
	if (!att.canDamage(def)) return 0
	let damage = Math.max(0, att.AP())
	return damage
}

function chooseDmgTarget(source, targets, amount = 1, mandatory = false, kill = true) {
	if (targets.length < 1) return null
	targets = mySort(targets, c => kill ? c.HP() : -c.HP() - 9 * (c.damage < 1 && inStr(c.text, "is damaged")))
	if (!mandatory) targets = targets.filter(c => kill ? source.canDamage(c) : !source.canDamage(c))
	return (kill && mySort(targets.filter(c => c.HP() === amount), c => c.rested))[0] || targets[0]
}

async function doBattle(att, def, ctx) {
	if (def.isUnit() && !def.owner.battle.includes(def)) {
		return
	}
	if (!att.canDamage(def)) {
		log(`🛡️${def} would take no battle damage from ${att}`)
		return
	}
	attacker = att
	defender = def
	for (const kw of def.kw_eot) {
		const mo = kw.match(/redirect_battle_damage (\d+)/)
		if (mo) {
			for (const c of def.owner.battle) {
				if (c.cid === mo[1]) {
					log("↪Damage redirect to " + c)
					defender = c
				}
			}
		}
	}
	def = defender
	if (def.HP() < 1) {
		// Action or attack trigger could have killed it. TODO: vfx that instead?
		return
	}
	// Damage Step
	// vfx to show defender
	await battle(att, def)
	let afs = att.hasKw("First Strike")
	let dfs = def.hasKw("First Strike")
	let dmg_to_def = getDamage(att, def)
	let dmg_to_att = getDamage(def, att)
	if (dfs && !afs) {
		await dealBattleDamage(def, att, dmg_to_att)
		dmg_to_att = 0
	}
	if (att.HP() > 0) {
		// CR 10-1-6-6. If multiple effects belonging to both you and your opponent trigger, 
		// they do so simultaneously, and all of the active player’s triggered 
		// effects are resolved first, after which all of the standby player’s 
		// triggered effects are resolved.
		if (dmg_to_def > 0) {
			await dealBattleDamage(att, def, dmg_to_def)
		}
		// TODO Undying etc.
		if (def.owner.trash.includes(def) || def.HP() < 1) {
			def.kw_eob.push("dead")
			if (def.isUnit()) {
				const breach = att.getBreach()
				if (breach) {
					if (def.owner.base) {
						log("➤Breach " + breach)
						await dealDamage(att, def.owner.base, breach)
					} else if (def.owner.shield.length > 0) {
						log("➤Breach " + breach)
						// Breach is damage but not battle damage.
						await def.owner.breakShield(att, true, false)
					}
				}
			}
			let context = {destroyer: att}
			await destroy(def, context, false)
			await publish(" destroys an enemy card with battle damage, ", [att], context)
			if (def.isUnit()) {
				await publish(" destroys an enemy Unit with battle damage, ", att.owner.base ? [att, att.owner.base] : [att], context)
			}
		}
	}
	if (afs && def.hasKw("dead")) dmg_to_att = 0
	if (dmg_to_att > 0) {
		await dealBattleDamage(def, att, dmg_to_att)
	}
	if (att.HP() < 1 && !att.owner.trash.includes(att)) {
		let context = {destroyer: def}
		await destroy(att, context, false)
		await publish(" destroys an enemy card with battle damage, ", [def], context)
		if (def.isUnit()) {
			await publish(" destroys an enemy Unit with battle damage, ", def.owner.base ? [def, def.owner.base] : [def], context)
		}
	}

	// End of Battle Step
	// No Base affected yet
	for (const c of p1.battle.concat(p2.battle)) {
		c.ap_eob = 0
		c.hp_eob = 0
		c.kw_eob = []
	}
	for (const c of p1.trash.concat(p2.trash).concat(p1.hand).concat(p2.hand)) {
		c.ap_eob = 0
		c.hp_eob = 0
		c.kw_eob = []
	}
	att.owner.kw_eob = []
	def.owner.kw_eob = []
	defender = null
	attacker = null
	await render()
}

async function dealBattleDamage(att, def, amount) {
	let ctx = {
		active_card: att,
		active_target: def,
		active_damage: amount
	}
	await run(att, "", "When this Unit deals battle damage", ctx)
	await run(def, "", "receives damage", ctx)
	await run(def, "", "receives battle damage", ctx)
	if (ctx.active_damage > 0) def.damage += ctx.active_damage
}

async function dealDamage(source, target, amount = 1) {
	if (!target) return false
	if (target.hasKw("noDmg enemy.unit.effect") && source.isUnit()) return false
	if (target.text === "During your opponent's turn, this Unit can't receive effect damage from enemy Units that are Lv.5 or lower." && active_player !== target.owner && source.isUnit() && source.LEVEL() <= 5) return false
	amount = Math.max(0, parseInt(amount) - target.hp_eob)
	if (target.hp_eot > 0) {
		amount -= target.hp_eot
		target.hp_eot = Math.max(0, target.hp_eot - amount)
	}
	log(`🎯${source} deals ${amount} effect damage to ${target}`)
	if (amount > 0) {
		target.effect_damage = amount
		//await run(target, "When this Unit receives effect damage from an enemy, ", ctx)
		await publish(" receives effect damage, ", target.owner.battle, {
			source: source,
			target: target
		})
		target.damage += Math.max(0, target.effect_damage)
		if (target.HP() < 1) {
			await destroy(target, {destroyer: source}, false)
		}
	}
	return true
}

function getSectionText(card, act = "Main", clause = "", limit = true) {
	// debug card
	// if (card.id === "GD04-036" && act === "Deploy") {
	//  	log("FIXME: DEBUG " + act + " " + clause + " " + card)
	// }
	let mo = null
	const rex = new RegExp("([^\n]*?)" + (clause ? clause : ("\\[([^\\]]*?)" + act + "([^\\]]*?)\\]")) + "([^.].+?)(?:\n|$)")
	let i = 0
	for (let line of card.text.split("\n")) {
		if (mo = line.match(rex)) break
		++i
	}
	if (!mo) {
		for (let line of card.kw_eot) {
			if (mo = line.match(rex)) break
		}
	}
	if (!mo) return ""
	if (!CARDS[card.id].covered_lines) CARDS[card.id].covered_lines = {}
	CARDS[card.id].covered_lines[i] = (CARDS[card.id].covered_lines[i] || 0) + 1
	const limits = mo[1]
	if (limits && limits[0] === "(") return ""  // No reminder text.
	if (inStr(limits, "During your turn") && active_player !== card.owner) return ""
	if (inStr(limits, "During Pair") && !(card.pilot || card.unit)) return ""
	if (inStr(limits, "During Link") && !card.linked()) return ""
	const limits2 = mo[2]
	const limits3 = mo[3]
	let text = mo.length === 3 ? mo[2] : mo[4]
	// if ((act === "During Pair" || act === "During Link") && (text.indexOf("[") === 0 || text.indexOf("During") === 0 || text.indexOf("When") === 0)) return ""

	let l3ok = !limits3
	let mo2 = null
	if (!l3ok) {
		// [When Paired･(Cyber-Newtype)/(Newtype) Pilot]
		mo2 = limits3.match(/^･\((.+)\) Pilot$/)
		if (mo2 && (!card.pilot || !mo2[1].split(")/(").some(part => card.pilot.hasTrait(part)))) {
			// log(`🚫No link; ${card.pilot.traits} not in ${mo2[1]}`)
			return ""
		}
		l3ok = true
	}
	if (!l3ok) {
		mo2 = limits3.match(/^･Lv.(\d) or Higher Pilot$/)
		if (mo2 && !card.pilot.level >= parseInt(mo2[1])) return ""
		l3ok = true
	}
	if (!l3ok) {
		mo2 = limits3.match(/^･Lv.(\d) or Lower Pilot$/)
		if (mo2 && !card.pilot.level <= parseInt(mo2[1])) return ""
		l3ok = true
	}
	if (!l3ok) {
		mo2 = limits3.match(/^･(White|Blue|Purple|Red|Green) Pilot$/)
		if (mo2 && !card.pilot.color === mo2[1].toUpperCase()) return ""
		l3ok = true
	}

	if (act != "Pilot") {
		if ((mo.length > 3 && limits2 && limits2 !== "Activate･") || !l3ok) log(`🚩🚩FIXME: ${card} ACT${act}/CLAUSE${clause} LIMITS2` + limits2 + "LIMITS3" + limits3 + " MO" + mo + " TEXT" + text + " MO2" + mo2, true, true, true)
	}
	// TODO: Full text line?
	if (inStr(limits, "[Once per Turn]")) text = "[Once per Turn]" + text
	if (limit && once_per_turn.includes(text + card.cid)) return ""
	return text
}
/** runs card and pilot text */
async function run(card, act = "Main", clause = "", ctx = {}) {
	if (!card) return false
	if (card.type === "COMMAND") {
		// log("DEBUG Running " + card + " " + act + " " + clause)
	}
	let rv = await runCard(card, act, clause, ctx)
	if (card.pilot && card.pilot.type === "PILOT") {
		rv = rv | await runCard(card.pilot, act, clause, ctx)
		// if (!rv && inStr(clause, " deals damage to an ")) {
		// 	log("FIXME: SHOULD HAVE RAN " + card.pilot.name + " TEXT? act: " + act + " clause: " + clause + " text: " + getSectionText(card.pilot, act, clause) + " defender: " + defender)
		// 	await runCard(card.pilot, act, clause, ctx)
		// }
	}
	return rv
}
/** runs events */
async function publish(clause, cards, ctx) {
	for (const c of cards) await run(c, "", clause, ctx)
}
/** logs ran */
async function runCard(card, act, clause = "", context = {}) {
	let t = getSectionText(card, act, clause)
	if (!t) return false
	let rv = await runCard2(card, act, clause, t, {...context, running_card: card})
	if (rv) {
		if (inStr(t, "[Once per Turn]")) once_per_turn.push(t + card.cid)
		log(`⚡${card.owner.name} ran ${card} ${(act || clause)}: ${t}`)
		if (card.type === "COMMAND" && ["Action", "Main"].includes(act)) {
			if (card.hasTrait("Special Move")) {
				card.owner.kw_eot.push("GD05-089")
				await publish("When you activate a (Special Move) Command's [Main]/[Action], ", card.owner.battle)
			}
			await publish("When you activate a Command's [Main]/[Action] effect, ", card.owner.battle)
		}
	}
	return rv
}
async function runCard2(card, act, clause = "", t = "", ctx = {}) {
	if (!t) t = getSectionText(card, act, clause)
	if (!t) {
		if (clause || inStr(card.text, act)) log(`🚩No act ${act} or clause "${clause}" found in ${card.id} ${card.text}`)
		return false
	}
	// if (t === "Add 1 of your Shields to your hand. Then, if it is your turn, look at the top 2 cards of your deck and return 1 to the top. Place the remaining card into your trash.") {
	// 	log("FIXME: breakpoint")
	// }
	const ai = (active_player === p1 ? p1ai.checked : p2ai.checked)
	const p = card.owner
	const en = (p === p1 ? p2 : p1)
	const myturn = (active_player === p)
	const fu = p.battle
	const fua = p.usefulAttackers()
	const eu = mySort(en.battle, c => -c.COST())
	// make sure to apply effects to the unit card
	const u = card.unit || card
	let targets = []
	let target = null
	let mo = null

	// debug card rules
	if (card.id === DEBUG_ID && act === DEBUG_ACT) {
		debugger;
		// breakpoint here
		// log("FIXME: DEBUG " + act + " " + clause + " " + card)
	}

	if (ctx.destroyer && ctx.destroyer.hasTrait("Neo Zeon") && u.type === "UNIT") p.kw_eot.push("Neo Zeon friendly fire")

	// trim if and other cruft
	if (mo = t.match(/^\[Once per Turn\]/)) t = t.slice(mo[0].length)
	if (mo = t.match(/^\/?\/.(Action|Attack)./)) t = t.slice(mo[0].length)
	if (mo = t.match(/^Add 1 of your Shields to your hand. ?/)) {
		// Always return true in this block to log handled acts.
		target = p.shield.pop()
		if (target) {
			log(`🎴${p.name} took shield`)
			target.rested = false
			p.hand.push(target)
		}
		t = t.slice(mo[0].length)
		if (t === "") return true
		if (t.indexOf("Then, ") === 0) t = t.slice(6)
		if (mo = t.match(/^if it is your turn and a friendly \(Teiwaz\) Link Unit is in play, /)) {
			if (!myturn || !fu.some(c => c.hasTrait("Teiwaz") && c.linked())) return true
			t = t.slice(mo[0].length)
		}
	}
	if (clause === " attacks") {
		if (t === " an enemy Unit, if this Unit is rested, the attacking Unit gains <Breach 2> during this battle.") {
			if (!defender || !defender.isUnit() || attacker === u) return false
			eobKw(attacker, "Breach 2")
			return true
		}
		if (t === ", choose 1 enemy Unit whose Lv. is equal to or lower than that Unit. Rest it.") {
			if (attacker === u || !attacker.hasKw("Repair")) return false
			target = mySort(eu.filter(c => c.LEVEL() <= attacker.LEVEL()), c => -c.AP())[0]
			if (!target) return false
			rest(target, {rester: card})
			return true
		}
	}
	if (mo = t.match(/^area card, /)) {
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^area card with battle damage, /)) {
		if (!ctx.with_battle_damage) return false
		t = t.slice(mo[0].length)
	}
	else if (mo = t.match(/^area card with damage, /)) {
		try {
			if (!ctx.with_damage) return false
		} catch(ex) {
			log(`🚩🚩FIXME: ${card} ${act}${clause} has no context?! ${ex}`, true, true, true)
			debugger;
		}
		t = t.slice(mo[0].length)
	}	
	if (mo = t.match(/^[Dd]uring your turn, /)) {
		if (!myturn) return false  // already checked in getSectionText
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^Place the top 2 cards of your deck into your trash\. If you placed a \(Vagan\) card with this effect, /)) {
		let ok = false
			;[1, 2].forEach(i => {
				let c = p.deck.pop()
				if (c) { trash(c); if (c.hasTrait("Vagan")) ok = true }
			})
		if (!ok) return true
		t = t.slice(mo[0].length)
	}
	if (t === "this Unit recovers the specified number of HP.)") {
		// Handled in End Phase; not all cards have the keyword.
		return false
	}
	// triggered by event and already found on card, meeting restrictions
	if (mo = t.match(/^with battle damage, /)) {
		t = t.slice(mo[0].length)
	}
	if (t === "deal the specified amount of damage to the first card in that opponent's shield area.)") {
		// Handled by breach code.
		return false
	}
	// on pair
	if (mo = t.match(/a \((.+?)\) Pilot with one of your blue Units, /)) {
		if (ctx.paired_unit.color !== "BLUE" || !ctx.paired_unit.pilot.hasTrait(mo[1])) return false
		t = t.slice(mo[0].length)
	}

	if (mo = t.match(/^If (\d+) or more friendly \(([^)]+)\) Units are in play, /)) {
		if (fu.filter(c => c.hasTrait(mo[2])).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If a friendly Unit with <(.+?)> is in play, /)) {
		if (!fu.some(c => c.hasKw(mo[1]))) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If a friendly (blue|green|purple|red|white) Base is in play, /)) {
		if (!p.base || !p.base.color === mo[1].toUpperCase()) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If (\d+) or more other rested friendly Units are in play, /)) {
		if (fu.filter(c => c !== u && c.rested).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If it is your opponent's turn, /)) {
		if (myturn) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If this Unit has 5 or more AP,? /)) {
		if (u.AP() < 5) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^and it is attacking an enemy Unit, /)) {
		if (!attacker || attacker !== u || !defender || !defender.isUnit()) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If there are (\d+) or less enemy Shields, /)) {
		if (en.shield.length > mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If there are (\d+) or more cards in your trash, /)) {
		if (p.trash.length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If there are (\d+) or more \(([^)]+?)\) (Unit|Command|Pilot|Base)? ?cards in your trash, /)) {
		if (p.trash.filter(c => c.hasTrait(mo[2]) && (mo[3] ? c.type === mo[3].toUpperCase() : true)).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If there are (\d+) or more \(([^)]+)\)\/\(([^)]+)\) cards in your trash, /)) {
		if (p.trash.filter(c => c.hasTrait(mo[2]) || c.hasTrait(mo[3])).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If there are 2 or more enemy players, /)) {
		return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If there are (\d+) or more (other )?rested Units in play, /) || t.match(/If (\d+) or more other rested Units are in play, /)) {
		if (mo[2] && fu.concat(eu).filter(c => c.rested).length < mo[1]) return false
		else if (fu.concat(eu).filter(c => c !== u && c.rested).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you have (\d+) or more other Units in play, /)) {
		if (fu.filter(c => c !== u && c.rested).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If your opponent has (\d+) or more cards in their hand, /)) {
		if (en.hand.length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^Place the top card of your deck into your trash. If you placed a card that is Lv.(\d+) or higher with this effect, /)) {
		if (p.deck.length < 1) return false
		target = p.mill()[0]
		if (target.LEVEL() < mo[1]) return false
		t = t.slice(mo[0].length)
	}

	if (mo = t.match(/^set this Unit as active. ?/)) {
		await activate(u)
		t = t.slice(mo[0].length)
		if (t === "") return true
		target = u
	}

	// Main
	if (t === "Choose 1 friendly (Academy) Unit. During this turn, it may choose an active enemy Unit with 5 or less AP as its attack target. If you use an EX Resource to play this card, choose 1 to 2 friendly (Academy) Units instead.") {
		let their = eu.filter(c => !c.rested && c.AP() <= 5)
		if (their.length < 1) return false
		targets = fua.filter(c => c.hasTrait("Academy")).slice(0, (spent.length > 0) ? 2 : 1)
		if (targets.length < 1) return false
		if (spent.length > 0 && targets.length < 2) return false
		for (target of targets) eotKw(target, "canAttack enemy.unit.ap5min")
		return targets.length > 0
	}
	// During your turn is already checked in getSectionText
	if (t === " a (Dawn of Fold) Command card using an EX Resource, draw 1.") {
		if (!ctx.active_card.traits.includes("Dawn of Fold") || spent.length < 1) return false
		await p.draw()
		return true
	}
	if (t === " a (Dawn of Fold) Command card using an EX Resource, you may pair that card from your trash with one of your Units with \"Gundam Lfrith\" in its card name.") {
		if (spent.length < 1 || !inStr(ctx.active_card.text, "[Pilot]")) return false
		target = p.getPairableUnits().filter(c => inStr(c.name, "Gundam Lfrith"))[0]
		if (!target) return false
		await pair(target, ctx.active_card)
		return true
	}

	// Attack
	if (t === "If this Unit is damaged, draw 1.") {
		if (u.damage < 1) return false
		await p.draw()
		return true
	}
	if (t === "Units that are Lv.7 or lower can't activate <Blocker> during this battle.") {
		eu.filter(c => c.LEVEL() <= 7).forEach(c => eobKw(c, "/Blocker"))
		return true
	}

	// trim ifs
	if (mo = t.match(/^[Ii]f an enemy player has (\d+) or more cards in their hand, /)) {
		if (en.hand.length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (t === "If this Unit is destroyed by one of your (Neo Zeon) card's effects, add it from your trash to your hand.") {
		if (!ctx.destroyer.hasTrait("Neo Zeon")) return false
		toHand(u, true)
		return true
	}
	if (t === "If this Unit is destroyed with battle damage, you and the player who destroyed this Unit draw 1.") {
		if (!ctx.destroyer) return false
		await p.draw()
		await en.draw()
		return true
	}
	if (mo = t.match(/^If you are attacking an enemy Unit, /)) {
		if (!defender || !defender.isUnit()) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you are attacking a damaged enemy Unit, /)) {
		if (!defender || defender.damage < 1) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you are Lv.(\d+) or higher, /)) {
		if (p.resource.length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you have activated a \(Special Move\) Command card's \[Main\]\/\[Action\] during this turn, /)) {
		if (!p.kw_eot.includes("GD05-089")) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you deploy this Unit from your trash, /)) {
		if (!card.from_trash) return false
		t = t.slice(mo[0].length)
	}
	// if (mo = t.match(/^During this turn, if it is your turn, /)) {
	// 	if (!myturn) return false
	// 	t = t.slice(mo[0].length)
	// }
	if (mo = t.match(/^[Ii]f it is your turn, /)) {
		if (!myturn) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you are attacking the enemy player, /)) {
		if (!attacker || defender) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If this is an? \((.+)\) Unit, /)) {
		if (!u.hasTrait(mo[1])) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If this Unit is (blue|green|purple|red|white), /)) {
		if (u.color.toLowerCase() !== mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you have an? \((.+?)\) (Link )?Unit in play, /) || t.match(/^[Ii]f a friendly \((.+?)\) (Link )?Unit is in play, /)) {
		if (!fu.some(c => c.hasTrait(mo[1]) && mo[2] ? c.linked() : true)) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If another friendly \((.+?)\) Unit is in play, /) || t.match(/^[Ii]f you have another \((.+?)\) Unit in play, /)) {
		if (!fu.some(c => c !== u && c.hasTrait(mo[1]))) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^[Ii]f you have (\d) or more( other)? \((.+?)\) Units in play, /)) {
		const types = mo[3].split(")/(")
		if (!fu.filter(c => (mo[2] ? c !== u : true) && types.some(part => c.hasTrait(part))).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If you have an \(AEUG\) Link Unit in play, /)) {
		if (!fu.some(c => c.hasTrait("AEUG") && c.linked())) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^[Ii]f an enemy \((.+?)\) Unit is in play, /)) {
		if (!eu.some(c => c.hasTrait(mo[1]))) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^If an enemy Unit with 1 or less AP is in play, /)) {
		if (!eu.some(c => c.AP() <= 1)) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^[Ii]f there are (\d+) or more \((.+)\) cards in your trash, /)) {
		if (!p.trash.filter(c => c.hasTrait(mo[2])).length < parseInt(mo[1])) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^[Ii]f (\d+) or more rested Units are in play, /)) {
		if (fu.concat(eu).filter(c => c.rested).length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^[Ii]f (\d+) or more enemy Units are in play, /)) {
		if (eu.length < mo[1]) return false
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^[Ii]f this is a (blue|green|purple|red|white) Unit, /)) {
		if (u.color !== mo[1].toUpperCase()) return false
		t = t.slice(mo[0].length)
	}
	if (t === `Draw 1. Then, if there are 2 or more cards with "A Healthy Curiosity" in their card name in your trash, choose 1 enemy Unit with 4 or less HP. Rest it.`) {
		if (p.deck.length < 1) return false
		await p.draw()
		if (p.trash.filter(c => inStr(c.name, "A Healthy Curiosity")).length >= 2) {
			target = eu.filter(c => c.HP() <= 4 && !c.rested)[0]
			if (target) rest(target, {rester: card})
		}
		return true
	}
	if (t === "During this turn, friendly Units can't be destroyed by enemy effects. Then, draw 1.") {
		if (p.deck.length < 1) return false
		// p.kw_eot.push("friendly Units can't be destroyed by enemy effects")
		fu.forEach(c => eotKw(c, "can't be destroyed by enemy effects"))
		await p.draw()
		return true
	}

	if (t === "When playing this card, choose 1 of the following effects and activate it:") {
		if (card.text === "[Action]When playing this card, choose 1 of the following effects and activate it:\n■Choose 1 enemy Unit with 5 or less HP. Return it to its owner's hand.\n■Choose 1 Unit. It recovers 3 HP.") {
			if (eu.some(c => c.HP() <= 5)) t = "Choose 1 enemy Unit with 5 or less HP. Return it to its owner's hand."
			else /* if (fu.some(c => c.damage > 0 && c.getRepair() < 3)) */ t = "Choose 1 Unit. It recovers 3 HP."
		}
		if (card.text === "[Main]When playing this card, choose 1 of the following effects and activate it:\n■Place 1 rested Resource.\n■Choose 1 Pilot card that is Lv.5 or higher from your trash. Add it to your hand.") {
			if (p.trash.some(c => c.type === "PILOT" && c.LEVEL() >= 5)) t = "Choose 1 Pilot card that is Lv.5 or higher from your trash. Add it to your hand."
			else t = "Place 1 rested Resource."
		}
	}

	if (t === "this gains <First Strike> during this turn.") {
		// Only hit is ST06-001 and When Linked is mandatory.
		// if (myturn && !eu.some(c => c.rested) && !u.kw_eot.some(kw => kw.match(/^canAttack active/))) return false
		// target = mySort(fua.filter(c => c.level <= 2), c => c.AP())[0]
		// if (!target) return false
		eotKw(u, "First Strike")
		return true
	}
	if (t === "add this card to your hand.") {
		bounce(card)
		return true
	}
	// deploy
	if (t === "deal 3 damage to this Base.") {
		await dealDamage(u, u, 3)
		return true
	}
	if (mo = t.match(/^[Dd]eploy (\d) (rested )?\[([^\]]+)\].*? Unit tokens?\.$/)) {
		for (let i = 0; i < mo[1]; ++i) {
			await p.deployToken(ctx, mo[3], mo[2])
		}
		return true
	}
	if (inStr(t, "deploy 1 [Parts]((League Militaire)･AP1･HP1･This Unit can't choose the enemy player as its attack target) Unit token.")) {
		await p.deployToken(ctx, "Parts")
		return true
	}
	if (inStr(t, "deploy 1 [Tallgeese]((OZ)･AP4･HP2) Unit token. If it is your turn and a card with \"Corsica Base\" in its card name is in your trash, deploy 2 [Leo]((OZ)･AP1･HP1) Unit tokens instead.")) {
		if (myturn && p.trash.filter(c => c.name.indexOf("Corsica Base")).length > 0) {
			await p.deployToken(ctx, "Leo")
			await p.deployToken(ctx, "Leo")
		} else {
			await p.deployToken(ctx, "Tallgeese")
		}
		return true
	}

	if (t === "All players each choose 1 of their Resources. Set them as active.") {
		for (let player of [p, en]) {
			target = player.resource.filter(c => c.rested)[0]
			if (!target) return false
			await activate(target)
		}
		return true
	}

	// Trim "you may choose"
	// choose
	if (mo = t.match(/^([Yy]ou may )?[Cc]hoose /) || t.match(/[Aa]ll enemy players (may )?each choose /)) {
		let optional = !!mo[1]
		t = t.slice(mo[0].length)
		// Base
		if (mo = t.match(/^1 \(([^)]+?)\) Base card from your trash. Deploy it.$/)) {
			target = p.trash.filter(c => c.type === "BASE" && c.hasTrait(mo[1]))[0]
			if (!target) return false
			await p.deployFromTrash(ctx, target)
			return true
		}
		if (mo = t.match(/^1 enemy Base. /)) {
			if (!en.base) return false
			targets = [en.base]
			target = en.base
			t = t.slice(mo[0].length)
		}
		if (t === "1 rested friendly Base. Set it as active. If you do, all enemy Units get AP-1 during this turn.") {
			if (!p.base || !p.base.rested) return false
			await activate(p.base)
			eu.forEach(c => eotAP(c, -1))
			return true
		}
		// Pilot
		if (mo = t.match(/^1 Pilot paired with an enemy Unit that is Lv.(\d+) or lower. /)) {
			targets = eu.filter(c => c.pilot && c.LEVEL() <= mo[1])
			if (targets.length < 1) return false
			target = targets[0].pilot
			t = t.slice(mo[0].length)
		}
		// if (t === "1 enemy Pilot. Return it to its owner's hand.") {
		// 	target = eu.filter(c => c.pilot)[0]
		// 	if (!target) return false
		// 	bounce(target.pilot)
		// 	return true
		// }
		// player
		if (mo = t.match(/^1 enemy player\.? /)) {
			t = t.slice(mo[0].length)
			if (t === "Destroy the first 2 cards in that player's shield area.") {
				let i = 0
				if (en.base) {
					await destroy(en.base, ctx)
					++i
				}
				for (; i < 2; ++i) await en.breakShield(card, false)
				return true
			}
			if (t === "They may draw 1. If they draw with this effect, draw 1.") {
				if (en.deck.length < 2 || p.deck.length < 2) return false
				await en.draw()
				await p.draw()
				return true
			}
			if (mo = t.match(/^with (\d+) or more cards in their hand. /)) {
				if (en.hand.length < mo[1]) return false
				t = t.slice(mo[0].length)
				if (t === "They discard 1.") {
					await en.discard(ctx)
					return true
				}
			}
		}
		if (mo = t.match(/^1 of your (rested )?Resources. /)) {
			target = p.resource.filter(r => r.rested)[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		// Unit
		// e.g. "[Burst]Deploy this card.\n[Deploy]Add 1 of your Shields to your hand. Then, choose 1 rested friendly white (G Generation) Unit. Set it as active. It can't attack during this turn."
		// "Choose 1 of your other (Zeon) Link Units. It gains <Breach 1> during this turn." BUT "Choose 1 other active friendly (Clan) Unit."
		// "Choose 1 active friendly Unit with <Blocker> and 1 enemy Unit that is Lv.4 or lower." (TODO)
		// instead
		if (t === "1 enemy Unit. Deal 1 damage to it. If a friendly (Mafty) Link Unit is in play, deal 2 damage instead.") {
			const dmg = fu.some(c => c.hasTrait("Mafty") && c.linked()) ? 2 : 1
			return await dealDamage(u, chooseDmgTarget(u, eu, dmg), dmg)
		}
		if (mo = t.match(/^1 of their active Units. /)) {
			targets = eu.filter(c => !c.rested)
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^1 of their non-battling Units. /)) {
			targets = eu.filter(c => ![attacker, defender].includes(c))
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		// GD02-100
		if (t === "1 friendly damaged Unit. It recovers 2 HP. Then, draw 1.") {
			if (p.deck.length < 1) return false
			targets = mySort(fu.filter(c => c.damage > 0), c => -c.damage + c.getRepair())
			target = targets[0]
			if (!target) return false
			await target.recover(2)
			await p.draw()
			return true
		}
		if (t === "1 (X-Rounder) card from your trash and add it to your hand. If you do, discard 1.") {
			if (p.hand.length < 1) return false
			targets = p.trash.filter(c => c.hasTrait("X-Rounder"))
			target = targets[0]
			if (!target) return false
			toHand(target, true)
			await p.discard(ctx)
			return true
		}
		// Choose regex
		if (mo = t.match(/^(?<num>1 to 2|\d)? (?<mine>of your)? ?(?<other>other)? ?(?<state>active|rested)? ?(?<damaged>damaged|undamaged)? ?(?<flag>enemy|friendly)? ?(?<color>blue|green|purple|red|white)? ?(?<traits>\(.+?\))? ?(?<linked>Linke?d? )?(?<type>Unit|Command|Pilot)?( card)?(?<token> token)?s?\.? /)) {
			if (t.match(/^[^.]*from your trash/)) targets = p.trash
			else if (mo.groups.flag === "enemy") targets = mySort(eu, c => -c.AP())
			else if (!mo.groups.mine && !mo.groups.flag) targets = eu.concat(fu)
			else targets = mySort(fu, c => c.AP())
			if (mo.groups.type) targets = targets.filter(c => c.type === mo.groups.type.toUpperCase())
			if (mo.groups.other) targets = targets.filter(c => c !== u)
			if (mo.groups.state) {
				if (mo.groups.state === "active") targets = targets.filter(c => !c.rested)
				else targets = targets.filter(c => c.rested)
			}
			if (mo.groups.damaged) {
				if (mo.groups.state === "damaged") targets = targets.filter(c => c.damage > 0)
				else targets = targets.filter(c => c.damage === 0)
			}
			if (mo.groups.token) targets = targets.filter(c => c.isToken())
			if (mo.groups.color) targets = targets.filter(c => c.color === mo.groups.color.toUpperCase())
			if (mo.groups.traits) {
				let traits = mo.groups.traits.slice(1, -1).split(")/(")
				targets = targets.filter(c => traits.some(part => c.hasTrait(part)))
			}
			if (mo.groups.linked) targets = targets.filter(c => c.linked())
			targets = mySort(targets, c => myturn ? c.rested + c.sick : !c.rested)
			if (mo.groups.num === "1 to 2") targets = targets.slice(0, 2)
			else if (mo.groups.num > 1) {
				// TODO, maybe let user select
				targets = targets.slice(0, mo.groups.num)
				if (targets.length < mo.groups.num) return false
			}
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^with(out)? <(.+?)>\.? /)) {
			targets = mo[1] ? targets.filter(c => !c.hasKw(mo[1])) : targets.filter(c => c.hasKw(mo[1]))
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^with (\d+)( or less| or more)? AP\.? /)) {
			if (mo[2] === " or less") targets = targets.filter(c => c.AP() <= mo[1])
			else if (mo[2] === " or more") targets = targets.filter(c => c.AP() <= mo[1])
			else targets = targets.filter(c => c.AP() == mo[1])
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^with (\d+)( or less| or more)? HP\.? /)) {
			if (mo[2] === " or less") targets = targets.filter(c => c.HP() <= mo[1])
			else if (mo[2] === " or more") targets = targets.filter(c => c.HP() <= mo[1])
			else targets = targets.filter(c => c.HP() == mo[1])
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^with(out)? "(.+?)" in its card name\.? /)) {
			targets = p.trash.filter(c => mo[1] ? !inStr(c.name, mo[2]) : inStr(c.name, mo[2]))
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^with no paired Pilot. /)) {
			targets = targets.filter(c => !c.pilot)
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		else if (mo = t.match(/^paired with an? \((.+?)\) Pilot. /)) {
			targets = targets.filter(c => c.pilot && c.pilot.hasTrait(mo[1]))
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}

		// with must be before that is
		if (mo = t.match(/^that (is|are) Lv\.(\d+)\. ?/)) {
			targets = targets.filter(c => c.LEVEL() == mo[2])
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
			if (t === "Rest it. If you do, choose 1 enemy Unit that is Lv.2 or lower. Return it to its owner's hand.") {
				let their = mySort(eu.filter(c => c.LEVEL() <= 2), c => -c.AP())[0]
				if (!their) return false
				rest(target, {rester: card})
				bounce(their)
				return true
			}
		}
		if (mo = t.match(/^that is Lv.1 or lower or has 1 or less AP. /)) {
			targets = targets.filter(c => c.LEVEL() <= 1 || c.AP() <= 1)
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^that (is|are) Lv.(\d+) or (higher|lower)\.? /)) {
			if (mo[3] === "lower") targets = targets.filter(c => c.LEVEL() <= mo[2])
			else targets = targets.filter(c => c.LEVEL() >= mo[2])
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^from your trash. /)) {
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^belonging to (an enemy|another|each enemy) player( with the most Units)?\. /)) {
			targets = targets.filter(c => c.owner !== p)
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^whose Lv. is equal to or lower than this Unit. /)) {
			targets = targets.filter(c => c.LEVEL() <= u.LEVEL())
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^with the highest Lv. /)) {
			target = mySort(targets, c => -c.LEVEL())[0]
			targets = targets.filter(c => c.LEVEL() === target.LEVEL())
			t = t.slice(mo[0].length)
		}
		if (mo = t.match(/^battling a friendly Unit with <(.+?)>. /)) {
			if (!attacker || !defender || !defender.isUnit()) return false
			if (attacker.owner === en) {
				if (attacker.HP() > mo[1] || !defender.hasKw(mo[2])) return false
				target = attacker
			}
			if (defender.owner === en) {
				if (defender.HP() > mo[1] || !attacker.hasKw(mo[2])) return false
				target = defender
			}
			t = t.slice(mo[0].length)
		}
		else if (mo = t.match(/^that is battling one of your Units that is Lv.(\d+) or higher. /)) {
			if (!attacker || !defender || !defender.isUnit()) return false
			if (attacker.owner === en) {
				if (defender.owner !== p || defender.LEVEL() < mo[1]) return false
				target = attacker
			}
			if (defender.owner === en) {
				if (attacker.owner !== p || attacker.LEVEL() < mo[1]) return false
				target = defender
			}
			t = t.slice(mo[0].length)
		}
		else if (mo = t.match(/^battling an enemy Unit. /)) {
			targets = targets.filter(c => c === attacker || c === defender)
			target = targets[0]
			if (!target) return false
			t = t.slice(mo[0].length)
		}
		if (targets.length > 1 && !ai) {
			let new_target = await chooseCard(targets)
			if (!new_target) {
				if (optional) return false
				else alert("Choice was mandatory. AI chooses.")
			} else target = new_target
		}

		// process choice
		if (t === "Exile it from the game. If you do, choose 1 of your (Vagan) Units. It gets AP+2 during this turn.") {
			let mine = fu.filter(c => !c.rested && !c.sick)[0]
			if (!mine) return false
			exile([target])
			eotAP(mine, 2)
			return true
		}
		if (t === "Exile them from the game. If you do, choose 1 enemy Unit that is Lv.4 or lower. Destroy it.") {
			target = eu.filter(c => c.LEVEL() <= 4 && !c.rested)[0]
			if (!target) return false
			exile(targets)
			await destroy(target, ctx)
			return true
		}
		if (t === "Exile them from the game. If you do, choose 1 enemy Unit that is Lv.4 or lower. Rest it.") {
			target = eu.filter(c => c.LEVEL() <= 4 && !c.rested)[0]
			if (!target) return false
			exile(targets)
			rest(target, {rester: card})
			return true
		}
		if (t === "Exile them from the game. If you do, choose 1 enemy Unit. Deal 2 damage to it.") {
			if (eu.length < 1) return false
			target = chooseDmgTarget(card, eu, 2)
			if (!target) return false
			await dealDamage(card, target, 2)
			return true
		}
		if (t === "Exile them from the game. If you do, choose 1 enemy Unit. Begin a battle between this Unit and it and only perform the damage step.") {
			target = eu.filter(c => c.AP() < u.HP() && u.canDamage(c))[0]
			if (!target) return false
			exile(targets)
			await doBattle(u, target)
			return true
		}
		if (t === "Exile them from the game. If you do, choose 1 enemy Unit. Destroy it.") {
			target = (!en.kw_eot.includes("friendly Units can't be destroyed by enemy effects") && mySort(eu, c => -c.AP())[0])
			if (!target) return false
			exile(targets)
			await destroy(target, ctx)
			return true
		}
		if (t === "Exile them from the game. If you do, choose 1 enemy Unit/Base that is Lv.8 or lower. Destroy it.") {
			const their = (!en.kw_eot.includes("friendly Units can't be destroyed by enemy effects") && mySort(eu, c => -c.AP())[0]) || en.base
			if (!their) return false
			exile(targets)
			await destroy(their, ctx)
			return true
		}
		if (t === "During this battle, battle damage this Unit would receive is dealt to that Unit instead.") {
			if (!defender || defender.AP() < u.HP()) return false
			target = targets.filter(c => c.HP() > defender.AP())[0]
			if (!target) return false
			log("↪Battle damge to " + target)
			u.kw_eob.push("redirect_battle_damage " + target.cid)
			return true
		}
		if (t === "Exile them from the game. If you do, deal 5 damage to the first card in your opponent's shield area.") {
			if (!en.base && en.shield.length < 1) return false
			exile(targets)
			if (en.base) await dealDamage(card, en.base, 5)
			else await en.breakShield(card)
			return true
		}
		if (t === "It can't receive battle damage from enemy Units during this battle.") {
			enemy = attacker === u ? defender : attacker
			if (!enemy.canDamage(u)) return false
			u.kw_eob.push("noDmg enemy.unit.lv9min")  // TODO: 10+
			return true
		}
		if (t === "It can't receive effect damage from enemy Units during this turn.") {
			eotKw(target, "noDmg enemy.unit.effect")
			return true
		}
		if (t === "Rest it.") {
			rest(target, {rester: card})
			return true
		}
		if (t === "Rest them.") {
			targets.forEach(target => rest(target, {rester: card}))
			return true
		}
		if (mo = t.match(/^and 1 (active )?enemy Unit. Rest them.$/)) {
			let mine = mySort(targets, c => c.AP())[0]
			let their = mySort(eu.filter(c => mo[1] ? !c.rested : true), c => -c.AP())[0]
			if (!their) return false
			rest(mine, {rester: card})
			rest(their, {rester: card})
			return true
		}
		if (mo = t.match(/^Deal (\d+) damage to it and this Unit.$/)) {
			if (optional && u.HP() <= mo[1]) return false
			if (defender && defender.HP() > u.AP()) target = defender
			else target = chooseDmgTarget(u, targets.filter(c => c !== defender), mo[1])
			if (!target) return false
			await dealDamage(u, target, mo[1])
			await dealDamage(u, u, 2)
			return true
		}
		if (mo = t.match(/^It recovers (\d+) HP and gets AP\+(\d+) during this turn.$/)) {
			await target.recover(mo[1])
			eotAP(target, mo[2])
			return true
		}
		if (mo = t.match(/^\1 of your \((.+?)\) Units\/Bases. It recovers (\d) HP.$/)) {
			target = fu.concat([p.base]).filter(c => c && c.hasTrait(mo[1]) && c.damage > 0)[0]
			if (!target) return false
			await target.recover(mo[2])
			return true
		}

		if (t === "Deal 1 damage to it for each 4 AP this Unit has.") {
			let dmg = Math.floor(u.AP() / 4)
			if (dmg < 1) return false
			target = chooseDmgTarget(card, targets, dmg)
			if (!target) return false
			await dealDamage(card, target, dmg)
			return true
		}
		if (mo = t.match(/^For each \(([^)]+)\) Unit card in your trash, it gets AP(-\d+) during this turn.$/)) {
			let n = p.trash.filter(c => c.hasTrait(mo[1])).length
			if (n < 1) return false
			target = mySort(targets, c => c.rested * 10 + -c.AP())[0]
			if (!target) return false
			eotAP(target, mo[1])
			return true
		}
		if (t === "Return it to its owner's hand. If you have a Link Unit in play, choose 1 enemy Unit with 4 or less HP instead.") {
			targets = eu.filter(c => !c.rested && c.HP() <= fu.some(c => c.linked()) ? 4 : 2)
			target = targets[0]
			if (!target) return false
			bounce(target)
			return true
		}
		else if (t === "Return it to its owner's hand.") {
			if (ai) target = mySort(targets, c => -c.COST())[0]
			bounce(target)
			return true
		}
		if (t === "Return them to their owners' hands.") {
			for (let c of targets) bounce(c)
			return true
		}
		// chosen boon/curse				
		if (t === "Return it to its owner's hand. Then, if there are 2 or more cards with \"Awakened Potential\" in their card name in your trash, you may choose 1 friendly Unit. It gains <Blocker> during this turn.") {
			bounce(target)
			if (p.trash.filter(c => c.name === "Awakened Potential").length >= 2) {
				target = fu[0]
				if (target) eotKw(target, "Blocker")
			}
			return true
		}
		if (t === "Deal damage to it equal to the number of friendly Unit tokens in play.") {
			const token_count = fu.filter(c => c.isToken()).length
			if (token_count < 1) return false
			return await dealDamage(card, chooseDmgTarget(u, targets, token_count), token_count)
		}
		if (t === "Destroy it.") {
			ctx = {...ctx, destroyer: card}
			await destroy(target, ctx)
			return true
		}
		if (t === "Destroy it. If there are 10 or more cards in your trash, choose 1 active enemy Unit that is Lv.4 or lower instead.") {
			if (p.trash.length >= 10) targets = mySort(eu.filter(c => !c.rested && c.LEVEL() <= 4), c => -c.AP())
			ctx = {...ctx, destroyer: card}
			await destroy(targets[0], ctx)
			return true
		}
		if (mo = t.match(/^Base/)) {
			if (!p.base || p.base.rested) return false
			if (t === "Base. Rest it. If you do, choose 1 enemy Unit that is Lv.4 or lower. It gets AP-2 during this battle.") {
				target = null
				if (attacker && attacker.owner !== p) target = attacker
				if (defender && defender.owner !== p) target = defender
				if (!target) return false
				rest(p.base, {rester: card})
				eobAP(target, 2)
				return true
			}
			if (t === "Base and 1 enemy Unit with 3 or less HP. Rest them.") {
				target = eu.filter(c => !c.rested && c.HP() <= 3)[0]
				if (!target || (!myturn && target.sick) || (myturn && fua.length < 1)) return false
				rest(p.base, {rester: card})
				rest(target, {rester: card})
				return true
			}
		}
		if (mo = t.match(/^Rest it. ?/)) {
			if (t === "Rest it. If a friendly (Jupitris) Link Unit is in play, choose 1 to 2 enemy Units with 3 or less HP instead.") {
				targets = eu.filter(c => !c.rested && c.HP() <= 3).slice(0, fu.some(c => c.hasTrait("Jupitris")) ? 2 : 1)
				if (targets.length < 1) return false
				for (const c of targets) rest(c, {rester: card})
				return true
			}
			if (t === "Rest it. If you do, all enemy players each choose 1 of their active Units. Rest them.") {
				target = mySort(targets, c => c.AP())[0]
				let their = mySort(eu.filter(c => !c.rested), c => c.AP())[0]
				if (!their) return false
				rest(target, {rester: card})
				rest(their, {rester: card})
				return true
			}
			if (t === "Rest it. If you do, choose 1 enemy Unit that is Lv.2 or lower. Return it to its owner's hand.") {
				let targets2 = eu.filter(c => c.LEVEL() <= 2)
				let target2 = targets[0]
				if (!ai) target2 = await chooseCard(targets2)
				if (!target2) return false
				if (!ai) target = await chooseCard(targets)
				if (!target) return false
				rest(target, {rester: card})
				bounce(target)
				return true
			}
			if (t === "Rest it. If you do, choose 1 enemy Unit whose Lv. is equal to or lower than the Unit rested with this ability. Deal 3 damage to it.") {
				const afu = fu.filter(c => !c.rested)[0]
				if (!afu) return false
				target = chooseDmgTarget(u, eu.filter(c => c.level <= afu.level), 3)
				if (!target) return false
				rest(afu, {rester: card})
				await dealDamage(card, target, 3)
				return true
			}
			if (t === "Rest it. If you do, choose 1 enemy Unit with 2 or less AP. Deal 2 damage to it.") {
				const mine = mySort(targets, c => c.LEVEL())[0]
				target = chooseDmgTarget(card, eu.filter(c => c.AP() <= 2), 2)
				if (!target) return false
				rest(mine, {rester: card})
				await dealDamage(card, target, 2)
				return true
			}
			if (t === "Rest it. If you do, choose 1 rested enemy Unit. Deal 2 damage to it.") {
				let mine = target
				if (!mine) return false
				target = chooseDmgTarget(card, eu.filter(c => c.rested), 2)
				if (!target) return false
				await rest(mine, true, {rester: card})
				await dealDamage(card, target, 2)
				return true
			}
			if (t === "Rest it. If you do, deal 2 damage to all enemy Units whose Lv. is equal to or lower than that Unit.") {
				const mine = mySort(targets, c => c.LEVEL())
				if (mine.length < 1) return false
				targets = mySort(eu, c => -c.LEVEL())
				if (targets.length < 1) return false
				let i = 0
				for (i = 0; i < mine.length; ++i) {
					if (mine[i].LEVEL() >= targets[0].LEVEL()) break
				}
				targets = targets.filter(c => c.LEVEL() <= mine[i])
				if (targets.length < 1) return false
				rest(mine[i], {rester: card})
				targets.forEach(async c => await dealDamage(u, c, 2))
				return true
			}
			if (t === "Rest it. If you do, draw 1. This Unit gains <High-Maneuver> during this turn.") {
				if (p.deck.length < 1) return false
				await rest(target, {rester: card})
				await p.draw()
				eotKw(u, "High-Maneuver")
				return true
			}
			rest(target, {rester: card})
			t = t.slice(mo[0].length)
			if (t === "") return true
		}
		if (mo = t.match(/^Set it as active. ?/)) {
			target = targets.filter(c => c.rested)[0]
			if (!target) return false
			await activate(target)
			t = t.slice(mo[0].length)
			if (t === "") return true
		}
		if (mo = t.match(/^Deal (\d+) damage to it\.$/)) {
			const dmg = parseInt(mo[1])
			return await dealDamage(u, chooseDmgTarget(u, targets, dmg), dmg)
		}
		// Non-Stackable
		if (mo = t.match(/^[Ii]t gains <(Blocker|First Strike|High-Maneuver|Suppression)> during this turn.$/)) {
			targets = targets.filter(c => !c.hasKw(mo[1]))
			target = targets[0]
			if (!target) return false
			if (myturn && mo[1] === "Blocker") return false
			if (!myturn && mo[1] === "High-Maneuver" || mo[1] === "Suppression") return false
			eotKw(target, mo[1])
			return true
		}
		if (mo = t.match(/^[Ii]t gains <(Breach \d)> during this turn.$/)) {
			if (!myturn) return false
			targets = targets.filter(c => !c.rested && !c.sick)
			target = targets[0]
			if (!target) return false
			eotKw(target, mo[1])
			return true
		}
		if (mo = t.match(/^[Ii]t gains <(Repair \d)> during this turn.$/)) {
			targets = targets.filter(c => c.damage > 0 || inStr(c.text, "While this Unit has <Repair>"))
			target = targets[0]
			if (!target) return false
			eotKw(target, mo[1])
			return true
		}
		if (t === "It can't activate <Blocker> during this turn.") {
			target = eu.filter(c => !c.rested && c.hasKw("Blocker"))[0]
			if (!target) return false
			eotKw(target, "/Blocker")
			return true
		}
		if (mo = t.match(/^During this turn, it may choose an active enemy Unit with (\d+) or less AP as its attack target\.$/)) {
			target = targets.filter(c => !c.rested && !c.sick)[0]
			if (!myturn || !target || !eu.some(c => !c.rested && c.AP() <= mo[1])) return false
			eotKw(u, `canAttack active.unit.ap${mo[1]}min`)
			return true
		}
		if (t === "During this turn, when it receives enemy battle damage, reduce it by 2.") {
			eotHP(target, 2)
			return true
		}
		if (t === "It won't be set as active during the start phase of your opponent's next turn.") {
			target.stunned = true
			return true
		}
		if (t === "During this turn, it may choose an active enemy Unit with <Blocker> as its attack target.") {
			eotKw(target, "canAttack enemy.unit.Blocker")
			return true
		}
		if (t === "Deal 2 damage to it. Then, if you have a Unit with \"Master Gundam\" in its card name in play, draw 1.") {
			let would_draw = fu.some(c => inStr(c.name, "Master Gundam"))
			if (would_draw && p.deck.length < 1) return false
			target = chooseDmgTarget(card, targets, 2)
			if (!target) return false
			await dealDamage(card, target, 2)
			if (would_draw) await p.draw()
			return true
		}

		if (mo = t.match(/^It gets AP-(\d+) during this turn\. ?/)) {
			target = mySort(targets, c => -c.AP() - 10 * (myturn ? c.rested : !c.rested))[0]
			if (!target) return false
			eotAP(target, -parseInt(mo[1]))
			t = t.slice(mo[0].length)
			if (t === "") return true
			if (t === "If you use an EX Resource to play this card, rest the enemy Unit.") {
				if (spent.length > 0) rest(target, {rester: card})
				return true
			}
		}
		if (mo = t.match(/^ ?It gets AP\+(\d) during this turn. ?/)) {
			target = mySort(targets, c => myturn ? c.rested + c.sick : !c.rested)[0]
			if (!target) return false
			eotAP(target, mo[1])
			t = t.slice(mo[0].length)
			if (t === "") return true
		}
		// choose, rare
		if (card.text === "[Action]Choose 1 friendly (Shrike Team) Unit. It gains the following effect during this turn:\n■[During Link][Destroyed]Choose 1 friendly (League Militaire) Unit. Set it as active.\n[Pilot][Helen Jackson]") {
			target = targets.filter(c => c.linked())[0]
			if (!target) return false
			eotKw(target, "[During Link][Destroyed]Choose 1 friendly (League Militaire) Unit. Set it as active.")
			return true
		}
	}
	// Potentially unchosen effects, eg "When a friendly (Clan) Unit links, it gains <Breach 3> during this turn."
	if (t === "It can't attack during this turn.") {
		target.sick = true
		return true
	}
	if (mo = t.match(/^It gains <Breach (\d+)> during this turn. ?/)) {
		if (!myturn || !eu.some(c => c.rested) || !en.base && en.shield.length < 1) return false
		//let their = mySort(eu.filter(c => c.rested), c => -c.HP())
		target = mySort(fu.filter(c => c.getBreach() < 1), c => -c.AP())[0]
		if (!target) return false
		//if (en.base)
		eotKw(target, `Breach ${mo[1]}`)
		t = t.slice(mo[0].length)
		if (t === "") return true
	}
	if (t === "After activating this card's [Main], you may pair this card from your trash with one of your (MF) Units.") {
		if (act === "Main") {
			target = p.getPairableUnits().filter(c => c.hasTrait("MF"))[0]
			if (!target) return true
			p.trash = p.trash.filter(c => c !== card)
			await pair(target, card)
			return true
		}
		return true
	}
	if (mo = t.match(/^You may pair 1 Pilot card with \"(.*?)\" in its card name from your hand with this Unit.$/)) {
		targets = p.hand.filter(c => inStr(c.name, mo[1]))
		if (u.pilot || targets.length < 1) return false
		await pair(targets[0], u)
		return true
	}
	if (mo = t.match(/^It gets AP-(\d+) during this battle./)) {
		if (!defender || !defender.isUnit()) return false
		eobAP(defender, -parseInt(mo[1]))
		t = t.slice(mo[0].length)
		if (t === "") return true
	}
	if (t === "It won't be set as active during the start phase of your opponent's next turn.") {
		target = mySort(eu.filter(c => c.level <= 2), c => c.HP())[0]
		if (!target) return false
		log("🎯Stunning " + target)
		target.stunned = true
		return true
	}
	if (mo = t.match(/^and 1 enemy Unit. Deal (\d) damage to them.$/)) {
		let dmg = parseInt(mo[1])
		const mine = chooseDmgTarget(card, targets, dmg, true, false)
		const their = chooseDmgTarget(card, eu, dmg, true)
		if (!mine || !their) return false
		await dealDamage(card, mine, dmg)
		await dealDamage(card, their, dmg)
		return true
	}
	// if (t === "Choose 1 to 2 enemy Units. Deal 1 damage to them.") {
	// 	const their1 = chooseDmgTarget(u, eu, 1, true)
	// 	const their2 = chooseDmgTarget(u, eu.filter(c => c !== their1), 1, true)
	// 	if (their1) await dealDamage(card, their1)
	// 	if (their2) await dealDamage(card, their2)
	// 	return !!(their1 || their2)
	// }
	if (t == "Destroy this Unit：Choose 1 enemy Base/enemy Shield this Unit is battling. Deal 6 damage to it.") {
		// The action step is before the damage step, so
		if (!(defender && defender.hasKw("First Strike") && defender.AP() >= u.HP()) && u.AP() >= 6) return false
		ctx = {...ctx, destroyer: card}
		await destroy(u, ctx)
		if (!defender) {
			if (en.shield.length < 1) return false
			await en.breakShield(card)
		} else await dealDamage(card, defender, 6)
		return true
	}
	if (t === "Rest 2 of your Units：Set this Unit as active.") {
		if (!u.rested) return false
		targets = mySort(fu.filter(c => !c.rested), c => -c.sick).slice(0, 2)
		if (targets.length < 2) return false
		if (targets[0].AP() + targets[1].AP() >= u.AP()) return false
		targets.forEach(c => rest(c))  // Activation is not an effect but causes one.
		await activate(u)
		return true
	}
	if (t === "Rest this Unit：Destroy this and choose 1 enemy Unit that is Lv.5 or lower. Deal 1 damage to it.") {
		if (u.rested) return false
		targets = eu.filter(c => c.LEVEL() <= 5)
		target = chooseDmgTarget(card, targets)
		if (!target) return false
		rest(u)
		await dealDamage(card, target)
		return true
	}
	if (t === "You may deal 1 damage to this Unit. If you do, choose 1 of your other (Tekkadan) Units. It recovers 1 HP.") {
		if (u.HP() < 2) return false
		target = fu.filter(c => c !== u && c.damage > 0 && c.hasTrait("Tekkadan"))[0]
		if (!target) return false
		if (!await dealDamage(card, u)) return false
		await target.recover()
		return true
	}
	// Deploy
	if (t === "During this turn, reduce its AP by an amount equal to the number of Unit cards with \"Gundam Virtue\" in their card names in your trash.") {
		eotAP(target, -p.trash.filter(c => inStr(c.name, "Gundam Virtue")).length)
		return true
	}
	if (mo = t.match(/^Choose 1 Command card that is Lv.(\d+) or lower from your trash. Add it to your hand.$/)) {
		target = p.trash.filter(c => c.type === "COMMAND" && c.LEVEL() <= mo[1])[0]
		if (!target) return false
		toHand(target, true)
		return true
	}
	if (t === "Destroy it. If you do, place the top 3 cards of your deck into your trash. Add 1 (Neo Zeon) Unit card you placed from your deck with this effect to your hand.") {
		target = targets.filter(c => c.rested)[0]
		if (!target) return false
		ctx = {...ctx, destroyer: card}
		await destroy(target, ctx)
		let milled = p.mill(3)
		target = milled.filter(c => c.type === "UNIT" && c.hasTrait("Neo Zeon"))[0]
		if (!target) return false
		toHand(target, true)
		return true
	}
	// ST08-011 if this ..., it
	if (t === "it gains <High-Maneuver> during this turn.") {
		eotKw(u, "High-Maneuver")
		return true
	}
	if (t === "Then, you may choose 1 of your Units with \"Shining Gundam\" in its card name. It gets <First Strike> during this turn.") {
		let boon_target = (myturn ? fua : defender)
		if (!boon_target || !inStr(boon_target.name, "Shining Gundam")) return true
		eotKw(boon_target, "First Strike")
		return true
	}
	if (t === "During this turn, it may choose an active enemy Unit that has no Pilot paired with it as its attack target.") {
		if (!fua.includes(target) || !eu.some(c => !c.rested && !c.pilot)) return false
		eotKw(target, "canAttack active.unit.nopilot")
		return true
	}
	if (t === "During this turn, it may choose a damaged active enemy Unit as its attack target.") {
		target = fua.filter(c => targets.includes(c))[0]
		if (!target || !eu.some(c => !c.rested && c.damage > 0)) return false
		eotKw(target, "canAttack active.unit.damaged")
		return true
	}
	if (t === "Choose 1 friendly Base and 1 enemy Unit with 3 or less HP. Rest them.") {
		if (!p.base || p.base.rested) return false
		target = eu.filter(c => c.HP() <= 3 && !c.rested)[0]
		if (!target) return false
		rest(p.base, {rester: card})
		rest(target, {rester: card})
		return true
	}
	if (inStr(t, `Deal 3 damage to it. If there are 2 or more cards with "Improved Technique" in their card name in your trash, choose 1 enemy Unit instead.`)) {
		target = p.trash.filter(c => inStr(c.name, "Improved Technique")).length >= 2 ? chooseDmgTarget(u, eu, 3) : chooseDmgTarget(u, targets, 3)
		return await dealDamage(card, target, 3)
	}
	// Main
	if (t === "It recovers 2 HP and gets AP+2 during this turn.") {
		target = targets.filter(c => c.damage > 0 && !c.rested && !c.sick)[0]
		if (!target) return false
		await target.recover(2)
		eotAP(target, 2)
		return true
	}
	if (t === "Destroy it. If you do, set this Unit as active. It can't choose the enemy player as its attack target during this turn.") {
		if (!u.rested) return false
		target = targets.filter(c => c.rested && c.HP() < u.HP() && c.AP() < u.AP() && eu.some(c2 => c2.AP() >= u.HP()))[0]
		if (!target) return false
		ctx = {...ctx, destroyer: card}
		if (await destroy(target, ctx)) {
			await activate(u)
			eotKw(u, "must_attack_unit")
			return true
		}
		return false
	}
	if (t === " effect, choose 1 enemy Unit. It gets AP-2 during this turn.") {
		debugger;
	}
	if (t === ", this Unit gains <Suppression> during this turn.") {
		// handled without ", " elsewhere
		return false
	}
	if (t === "Units/Bases. It recovers 2 HP.") {
		target = mySort(fu, c => -c.damage + c.getRepair())[0] || p.base
		if (!target || target.damage < 1) return false
		await target.recover(2)
		return true
	}
	if (t === "Base. Rest it. If you do, set this Unit as active. It can't choose the enemy player as its attack target during this turn.") {
		if (!p.base || p.base.rested || !u.rested) return false
		rest(p.base, {rester: card})
		await activate(u)
		eotKw(u, "must_attack_unit")
		return true
	}
	if (t === "When it deals battle damage to an enemy Unit that is Lv.5 or lower during this turn, destroy that enemy Unit.") {
		let kw = "When this Unit deals battle damage to an enemy Unit that is Lv.5 or lower, destroy that enemy Unit."
		target = fua.filter(c => !c.hasKw(kw))[0]
		if (!target) return false
		if (!eu.some(c => c.LEVEL() <= 5 && c.HP() > target.AP() && c.rested)) return false
		eotKw(target, kw)
		return true
	}

	if (t === "You may exile the specified number of (G Generation) cards in your trash from the game. If you do, activate the following effect:") {
		mo = u.text.match(/Development (\d+)/)
		targets = p.trash.filter(c => c.hasTrait("G Generation")).slice(0, parseInt(mo[1]))
		if (targets.length < parseInt(mo[1])) return false
		let oldtrash = p.trash
		exile(targets)
		if (!await runCard(card, "", "■")) p.trash = oldtrash
		return true
	}

	// Activate Main
	if (t === "Rest this Unit：Choose 1 of your Units. Deal 1 damage to it. It gets AP+1 during this turn.") {
		if (u.rested) return false
		targets = fu
		if (targets.length < 1) return false
		// TODO: Prefer canDamage false?
		if (ai) target = fua.filter(c => c !== u && c.HP() > 1)[0]
		else target = await chooseCard(fu)
		if (!target) return false
		rest(u)
		await dealDamage(card, target)
		eotAP(target)
		return true
	}
	if (t === "Rest 3 of your (CB) Units：Choose 1 enemy Unit. Deal 4 damage to it.") {
		let mine = fu.filter(c => !c.rested && c.hasTrait("CB")).slice(0, 3)
		if (mine.length < 3) return false
		target = chooseDmgTarget(card, eu, 4)
		if (!target) return false
		mine.forEach(async c => await rest(c))
		await dealDamage(card, target, 4)
		return true
	}
	// Burst - Optional, so why not Attack etc.?
	if (mo = t.match(/^Activate this card's \[\w+\].$/)) {
		await runCard(card, mo[1])
		return true
	}
	// Attack
	if (t === "Activate [Main] on the card paired with this Unit.") {
		if (!u.pilot) return false
		await runCard(u.pilot, "Main")
		return true
	}

	// battle damage trigger
	if (t === " to an enemy Unit, destroy that enemy Unit.") {
		target = (u === defender ? attacker : defender)
		if (eu.includes(target)) return false
		ctx = {...ctx, destroyer: card}
		await destroy(target, ctx)
		return true
	}
	mo = t.match(/^ to an enemy Unit that is Lv.(\d) or lower( [^)]+)?, /)
	if (mo) {
		target = (u === defender ? attacker : defender)
		if (!target || !(target.LEVEL() <= parseInt(mo[1]))) return false
		if (mo[2] === " that has no paired Pilot") {
			if (target.pilot) return false
		}
		if (!eu.includes(target)) return false
		t = t.slice(mo[0].length)
		if (t === "destroy that enemy Unit.") {
			ctx = {...ctx, destroyer: card}
			await destroy(target, ctx)
			return true
		}
		if (t === "if you have a (CB) Pilot in play, destroy that enemy Unit.") {
			if (!fu.some(c => c.pilot && c.pilot.hasTrait("CB"))) return false
			ctx = {...ctx, destroyer: card}
			await destroy(target, ctx)
			return true
		}
	}

	if (t === "During this battle, reduce battle damage it receives by 3.") {
		if (attacker && attacker.owner === p && defender) {
			eobHP(attacker, 3)
			return true
		}
		if (defender && defender.owner === p) {
			eobHP(defender, 3)
			return true
		}
		return false
	}
	if (mo = t.match(/^It may attack on the turn it is deployed.$/)) {
		targets = targets.filter(c => c.sick)
		target = targets[0]
		if (!target) return false
		target.sick = false
		return true
	}
	if (t === "During this turn, reduce the next damage it receives by 2. If you use an EX Resource to play this card, reduce by 4 instead.") {
		if (!defender) return false
		target = targets.filter(c => c === attacker || c === defender || (myturn && !c.rested || !c.sick) || (!myturn && c.rested))[0]
		if (!target || !target.owner.battle.includes(target)) return false
		eotHP(target, spent.length > 0 ? 4 : 2)
		return true
	}
	// Activate Action
	if (t === "①：If it is your opponent's turn, choose 1 Unit. It gets AP+1 during this battle.") {
		if (myturn) return false
		if (defender) target = defender
		if (!target || !await p.pay(1, card, true, t)) return false
		eotAP(target, 1)
		return true
	}
	// Activate Main
	if (mo = t.match(/^<Support (\d)>/)) {
		let support = parseInt(mo[1])
		if (u.rested || !u.sick && u.AP() > support) return false
		target = mySort(fu.filter(c => c !== u && !c.rested && !c.sick), c => c.AP())[0]
		if (!target) return false
		rest(u)  // pay != effect
		eotAP(target, support)
		if (target.hasTrait("ZAFT")) await publish("When you use this Unit's <Support> to increase a (ZAFT) Unit's AP, ", [u])
		return true
	}
	if (t === "①：Choose 1 of your rested white Units with <Blocker>. Set it as active. It can't attack during this turn.") {
		target = fu.filter(c => c.rested && c.color === "WHITE" && c.hasKw("Blocker"))
		target = targets[0]
		if (!target || !await p.pay(1, card, true, t)) return false
		await activate(target)
		target.sick = true
		return true
	}
	if (t === "①：Choose 1 other Unit that is being attacked. It gets AP+1 during this battle.") {
		if (!defender || defender === u || !defender.isUnit() || defender.owner !== p || !await p.pay(1, card, true, t)) return false
		eobAP(defender)
		return true
	}
	if (t === "①：Choose 1 Unit card with <Repair>/<Breach>/<First Strike>/<Support>/<High-Maneuver>/<Suppression>/<Blocker> from your trash. During this turn, this Unit gets AP+1 and all <Repair>/<Breach>/<First Strike>/<Support>/<High-Maneuver>/<Suppression>/<Blocker> on that Unit card.") {
		targets = p.trash.filter(c => c.type === "UNIT" && c.text && c.text[0] === "<")
		if (!ai) target = await chooseCard(targets)
		else target = targets[0]
		if (!target || u.rested || !await p.pay(1, card, true, t)) return false
		eotAP(u, 1)
		for (let kw of ["Repair", "Breach", "First Strike", "Support", "High-Maneuver", "Suppression", "Blocker"]) {
			if (target.hasKw(kw)) eotKw(u, kw)
		}
		return true
	}
	if (t === "④：Set this Unit as active.") {
		if (!u.rested || !await p.pay(4, card, true, t)) return false
		await activate(u)
		return true
	}
	if (mo = t.match(/^①：This Unit gets AP\+(\d+) during this (battle|turn).$/)) {
		if (myturn && u.rested) return false
		if (!myturn && u !== defender) return false
		if (!await p.pay(1, card, true, t)) return false
		if (mo[2] === "turn") eotAP(u, mo[1])
		else eobAP(u, mo[1])
		return true
	}
	if (t === "①, exile 1 Pilot card from your trash: Deal 1 damage to all enemy Units.") {
		// Guess no COMMAND with [Pilot]
		target = p.trash.filter(c => c.type === "PILOT")[0]
		if (!target || eu.length < 1 || !await p.pay(1, card, true, t)) return false
		exile([target])
		eu.forEach(async c => await dealDamage(card, c))
		return true
	}
	if (t === "②：If you have a Unit with \"Gundam Aerial\" in its card name that is Lv.5 or higher in play, deploy 1 [Gundnode]((Quiet Zero)･AP2･HP2･<Breach 1>) Unit token.") {
		if (!fu.some(c => inStr(c.name, "Gundam Aerial") && c.LEVEL() >= 5) || !await p.pay(2, card)) return false
		await p.deployToken(ctx, "Gundnode")
		return true
	}
	if (t === "Discard 1 (Zeon)/(Neo Zeon) Unit card：If a Pilot is not paired with this Unit, choose 1 (Newtype) Pilot card that is Lv.3 or lower from your trash. Pair it with this Unit.") {
		if (u.pilot) return false
		target = p.trash.filter(c => c.type === "PILOT" && c.traits.includes("Newtype") && c.LEVEL() <= 3)[0]
		if (!target) return false
		targets = p.hand.filter(c => c.type === "UNIT" && (c.traits.includes("Zeon") || c.traits.includes("Neo Zeon"))).slice(0, 1)
		if (targets.length < 1) return false
		await p.discard(ctx, 1, targets)
		await pair(u, target)
		return true
	}
	if (t === "Exile 3 (Titans) cards from your trash: This Unit gains <Breach 4> during this turn.") {
		if (!eu.some(c => c.rested) || !en.base && en.shield.length < 1) return false
		targets = p.trash.filter(c => c.hasTrait("Titans")).slice(0, 3)
		if (targets.length < 3) return false
		exile(targets)
		eotKw(u, "Breach 4")
		return true
	}
	if (t === "Exile 1 Command card from your trash：Choose 1 enemy Unit. It gets AP-1 during this turn.") {
		let mine = p.trash.filter(c => c.type === "COMMAND")[0]
		if (!mine) return false
		target = eu.filter(c => c.rested && c.AP() > 0)[0]
		if (!target) return false
		exile([mine])
		eotAP(target, -1)
		return true
	}
	if (t === "Exile 2 Command cards in your trash from the game：During this battle, when this Unit receives enemy damage, reduce it by 2.") {
		let mine = p.trash.filter(c => c.type === "COMMAND").slice(0, 2)
		if (mine.length < 2) return false
		if (![attacker, defender].includes(u)) return false
		let their = (u === attacker ? defender : attacker)
		if (!their || !their.canDamage(u)) return false
		exile(mine)
		eobHP(u, 2)
		return true
	}
	if (t === "Exile 2 Command cards from your trash from the game：Choose 1 damaged enemy Unit that is Lv.7 or lower. Rest it. It won't be set as active during the start phase of your opponent's next turn.") {
		let mine = p.trash.filter(c => c.type === "COMMAND").slice(0, 2)
		if (mine.length < 2) return false
		target = mySort(eu.filter(c => c.damage > 0 && c.LEVEL() <= 7), c => -c.AP())[0]
		if (!target) return false
		rest(target, {rester: card})
		target.stunned = true
		return true
	}

	// Base
	if (t === "Rest 1 of your (Earth Federation) Units：Choose 1 enemy Unit that is Lv.3 or lower. Rest it.") {
		if (myturn && fua.length < 2) return false
		target = eu.filter(c => c.LEVEL() <= 3 && !c.rested)[0]
		if (!target) return false
		let target2 = fu.filter(c => !c.rested && c.hasTrait("Earth Federation"))[0]
		if (!target2) return false
		rest(target2)
		rest(target, {rester: card})
		return true
	}
	if (t === "Exile 3 blue cards from your trash：Set this Unit as active. It can't choose the enemy player as its attack target during this turn.") {
		if (!u.rested) return false
		targets = p.trash.filter(c => c.color === "BLUE").slice(0, 3)
		if (targets.length < 3) return false
		exile(targets)
		eotKw(u, "must_attack_unit")
		await activate(u)
		return true
	}
	if (t === "set it as active. It can't choose the same enemy player or enemy team as its attack target during this turn.") {
		eotKw(u, "must_attack_unit")
		await activate(u)
		return true
	}
	if (t === `②, return this Unit to the bottom of its owner's deck：Choose 1 Unit card with "Impulse Gundam" in its card name that is Lv.4 or higher from your trash. Deploy it.`) {
		if (u.pilot || p.resource.filter(c => !c.rested).length < 2) return false
		// TODO: Improve target
		target = p.trash.filter(c => c.level >= 4 && inStr(c.name, "Impulse Gundam"))[0]
		if (!target || !u.rested || !await p.pay(2, u, true, t)) return false
		p.battle = p.battle.filter(c => c !== u)
		p.deck = [u].concat(p.deck)
		await p.deployFromTrash(ctx, target)
		return true
	}
	if (t === "During this turn, all enemy Units must choose that Unit as their attack target when attacking.") {
		eotKw(target, "must be attack target")
		return true
	}
	if (inStr(t, "During this turn, all Units paired with a Pilot get AP+2.")) {
		// TODO: Verify it doesn't affect future pairs.
		const mine = fu.filter(c => c.pilot && (myturn ? !c.rested : c.rested))
		const their = eu.filter(c => c.pilot && (myturn ? c.rested : !c.rested))
		if (mine.length <= their.length) return false
		fu.concat(eu).filter(c => c.pilot).forEach(c => eotAP(c, 2))
		return true
	}
	// Main
	if (t === "Destroy all Units that are Lv.4 or lower.") {
		let mine = fu.filter(c => c.LEVEL() <= 4)
		let their = eu.filter(c => c.LEVEL() <= 4)
		if (their.length < 1 || mine.length > their.length) return false
		if (mine.some(c => !c.rested)) return false
		ctx = {...ctx, destroyer: card}
		their.concat(mine).forEach(async c => await destroy(c, ctx))
		return true
	}
	// Attach command's trigger to player
	if (t === "During this turn, if a friendly (Superpower Bloc)/(UN) Unit destroys an enemy Unit with battle damage, choose 1 rested friendly (Superpower Bloc)/(UN) Unit. Set it as active. It can't attack during this turn.") {
		targets = mySort(fu.filter(c => c.hasTrait("Superpower Bloc") || c.hasTrait("UN")), c => -c.AP())
		if (!targets.some(c => c.rested)) return false
		target = targets[0]
		if (!target) return false
		const target2 = eu.filter(c => c.rested && c.HP() <= target.AP() && target.HP() > c.AP())
		if (!target2) return false
		// p.kw_eot.push(t)
		targets.forEach(c => eotKw(c, "If this destroys an enemy Unit with battle damage, choose 1 rested friendly (Superpower Bloc)/(UN) Unit. Set it as active. It can't attack during this turn."))
		return true
	}
	if (inStr(t, "Deploy 1 EX Base.")) {
		if (p.base) return false
		p.base = p.getCard("EXB-001")
		return true
	}
	if (mo = t.match(/^Choose 1 active friendly Base. Rest it. If you do, /)) {
		if (!p.base || p.base.rested) return false
		rest(p.base, {rester: card})
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^and 1 enemy Unit that is Lv.(\d+) or lower. Rest them.$/)) {
		let mine = mySort(targets, c => -c.sick + c.AP())[0]
		target = eu.filter(c => !c.rested && c.LEVEL() <= mo[1])[0]
		if (!mine || !target) return false
		rest(mine, {rester: card})
		rest(target, {rester: card})
		return true
	}
	// Activated Attack
	if (t === "this Unit gains <Breach 3> during this battle.") {
		eobKw(u, "Breach 3")
		return true
	}

	if (mo = t.match(/^[Tt]his Unit gets AP\+(\d+) during this battle.$/)) {
		eobAP(u, mo[1])
		return true
	}
	if (mo = t.match(/^this Unit recovers (\d+) HP.$/)) {
		return await u.recover(mo[1])
	}
	if (t === "②：Choose 1 of your Units. It recovers 2 HP.") {
		target = mySort(fu.filter(c => c.damage > 0), c => -c.damage)[0]
		if (!target) return false
		if (!await p.pay(2, u, true, t)) return false
		await target.recover(2)
		return true
	}
	if (t === "②：Choose 1 enemy Unit. It gets AP-1 during this battle.") {
		target = eu[0]
		if (attacker && attacker.owner === en && defender) target = attacker
		if (defender && defender.owner === en && attacker && defender.canDamage(attacker)) target = defender
		if (!target) return false
		if (!await p.pay(2, card, true, t)) return false
		eobAP(target, -1)
		return true
	}
	// blocked
	if (t === " by an enemy Unit that is Lv.4 or lower, it can't receive battle damage during this battle.") {
		eobKw(u, "noDmg enemy.unit.lv4min")
		return true
	}
	// battle Action command
	if (t === "rested (Academy) Unit. Change a battling enemy Unit's attack target to it.") {
		targets = fu.filter(c => c.rested && c.hasTrait("Academy"))
		t = "Change a battling enemy Unit's attack target to it."
	}
	if (t === "Change the attack target of the battling enemy Unit to it." || t === "Change a battling enemy Unit's attack target to it.") {
		if (myturn || !attacker) return false
		// TODO goodBattle(att, def) or first strike
		const aap = attacker.AP()
		const ahp = attacker.HP()
		const dap = defender && defender.AP() || 0
		const dhp = defender && defender.HP() || 0
		if (dhp > aap || dap >= ahp) return false
		let trait = inStr(t, "(Academy)") ? "Academy" : "CB"
		target = targets.filter(c => c !== defender && (c.HP() > aap || c.AP() >= ahp))[0]
		if (!target) return
		log("🎯" + target + " is new attack target")
		defender = target
		return true
	}
	if (mo = t.match(/^(It|They) can't receive battle damage from enemy Units that are Lv.(\d+) or lower during this turn.$/)) {
		const enemy_count = eu.filter(c => c.level <= mo[2] && myturn ? c.rested : (!c.rested && !c.sick)).length
		if (enemy_count < 1) return false
		// log("🎯" + targets + " battle damage protection from Lv2- this turn")
		if (mo[1] === "It") targets = targets.slice(0, 1)
		for (const target of targets) eotKw(target, `noDmg enemy.unit.lv${mo[2]}min`)
		return false
	}
	// Burst
	if (t === "Deploy this card." && card.type === "BASE") {
		card.rested = false
		p.base = card
		await render()
		await run(card, "Deploy")
		return true
	}
	if (t === "Add this card to your hand.") {
		return toHand(card)
	}
	if (t === "Add this card to your hand. If there are 3 or more (MF) cards in your trash, you may deploy it as an (AP3・HP3) Unit instead. (Don't treat it as a Pilot.)") {
		if (p.trash.filter(c => c.hasTrait("MF")).length >= 3) {
			card.type = "UNIT"
			card.ap = 3
			card.hp = 3
			await p.deploy(ctx, card)
			return true
		}
		return toHand(card)
	}
	if (t === "Rest this Base：All friendly Link Units get AP+1 during this turn.") {
		if (card.rested) return false
		// Main ability so check for can attack.
		targets = fu.filter(c => !c.rested && !c.sick && c.linked())
		if (targets.length < 1) return false
		rest(card)
		targets.forEach(c => eotAP(c, 1))
		await sleep(400)
		await render()
		return true
	}
	if (t === "all friendly (G Generation) Units recover 1 HP.") {
		fu.filter(async c => c.hasTrait("G Generation") && await c.recover())
		return true
	}
	if (t === "All friendly Units that are Lv.4 or lower recover 2 HP.") {
		targets = fu.filter(async c => c.LEVEL() <= 4 && c.damage > 0 && c.getRepair() < c.damage)
		if (targets.length < 1) return false
		targets.forEach(async c => await c.recover(2))
		return true
	}
	if (mo = t.match(/^Rest this Base：/)) {
		if (t === "Rest this Base：Choose 1 friendly Unit. It gets AP+1 during this turn.") {
			if (card.rested) return false
			target = fu.filter(c => !c.rested && !c.sick)[0]
			if (!target) return false
			rest(card)
			eotAP(target, 1)
			return true
		}
		if (t === "Rest this Base：Choose 1 friendly Unit. It recovers 1 HP.") {
			if (card.rested) return false
			target = fu.filter(c => c.damage > 0 && c.getRepair() < c.damage)[0]
			if (!target) return false
			rest(card)
			await target.recover(1)
			return true
		}
		if (t === "Rest this Base：Choose 1 friendly (Londo Bell) Unit. During this turn, when it receives enemy damage, reduce it by 1.") {
			if (card.rested) return false
			target = fu.filter(c => !c.rested && !c.sick && c.hasTrait("Londo Bell"))[0]
			if (!target) return false
			rest(card)
			eotHP(target)
			return true
		}
		if (t === "Rest this Base：Choose 1 friendly (ZAFT) Unit with 5 or more AP. It gains <Breach 3> during this battle.") {
			if (card.rested) return false
			target = fua.filter(c => c.hasTrait("ZAFT") && c.AP() >= 5)[0]
			if (!myturn || !target || !eu.some(c => c.rested) || !en.base && en.shield.length < 1) return false
			rest(card)
			eobKw(target, "Breach 3")
			return true
		}
		if (t === "Rest this Base：Choose 1 of your damaged Units. It gets AP+2 during this turn.") {
			if (card.rested) return false
			target = fu.filter(c => c.damage > 0 && !c.rested && !c.sick)[0]
			if (!target) return false
			rest(card)
			eotAP(target, 2)
			return true
		}
		if (mo = t.match(/^Rest this Base：If a friendly \(([^)]+?)\) Link Unit is in play, choose 1 friendly Unit. It gets AP\+2 during this turn.$/)) {
			if (card.rested || !fu.some(c => c.hasTrait(mo[1]) && c.linked())) return false
			target = fu.filter(c => !c.rested && !c.sick)[0]
			if (!target) return false
			rest(card)
			eotAP(target, 2)
			return true
		}
		if (mo = t.match(/^Rest this Base：If a friendly \(([^)]+?)\) Unit is in play, choose 1 enemy Unit. It gets AP-1 during this turn./)) {
			if (card.rested || !fu.some(c => c.hasTrait(mo[1]))) return false
			target = eu.filter(c => myturn ? c.rested : (!c.rested && !c.sick))[0]
			if (!target) return false
			rest(card)
			eotAP(target, -1)
			return true
		}
		if (t === "Rest this Base：If one of your Units has been destroyed by one of your (Neo Zeon) card's effects during this turn, deploy 1 (Neo Zeon) Unit card that is Lv.3 or lower from your hand.") {
			if (card.rested || p.battle.length > 5 || !p.kw_eot.includes("Neo Zeon friendly fire")) return false
			target = p.hand.filter(c => c.type === "UNIT" && c.hasTrait("Neo Zeon") && c.LEVEL() <= 3)[0]
			if (!target) return false
			rest(card)
			await p.deploy(ctx, target)
			return true
		}
	}
	if (t === "②：Deploy 1 [Gundam]((White Base Team)･AP3･HP3) Unit token if you have no Units in play, deploy 1 [Guncannon]((White Base Team)･AP2･HP2) Unit token if you have only 1 Unit in play, or deploy 1 [Guntank]((White Base Team)･AP1･HP1) Unit token if you have 2 or more Units in play.") {
		if (!await p.pay(2, u, true, t)) return false
		if (fu.length === 0) {
			await p.deployToken(ctx, "Gundam")
		} else if (fu.length === 1) {
			await p.deployToken(ctx, "Guncannon")
		} else {
			await p.deployToken(ctx, "Guntank")
		}
		return true
	}
	if (t === "②：Choose 1 friendly Unit with <Blocker>. Set it as active. It can't attack during this turn.") {
		target = fu.filter(c => c.rested && c.hasKw("Blocker"))[0]
		if (!target || !await p.pay(2, u, true, t)) return false
		await activate(target, true)
		target.sick = true
		return true
	}
	if (t === "It gains <Blocker> during this turn.") {
		if (myturn) target = mySort(targets, c => c.AP() - 10 * c.hasKw("Blocker"))[0]
		eotKw(target, "Blocker")
		return true
	}
	if (t === "It gains <First Strike> during this turn.") {
		target = targets[0]
		if (!target || eu.length < 1 || (myturn && en.getProne(target).length < 1)) return false
		if (!myturn && defender && targets.includes(defender) && defender.AP() >= attacker.HP()) target = defender
		else return false
		eotKw(target, "First Strike")
		return true
	}
	if (t === "If 1 to 4 enemy Units are in play, deploy 1 [Graze Custom]((Tekkadan)･AP2･HP2) Unit token. If 5 or more are in play, deploy 1 [Gundam Barbatos 4th Form]((Tekkadan)･AP4･HP4) Unit token.") {
		if (p.battle.length > 5) return false
		if (eu.length >= 1 && eu.length <= 4) await p.deployToken(ctx, "Graze Custom")
		else if (eu.length >= 5) await p.deployToken(ctx, "Gundam Barbatos 4th Form")
		return true
	}
	if (mo = t.match(/^Deploy 1( rested)? \[(.*?)\].*? Unit token.$/)) {
		await p.deployToken(ctx, mo[2], mo[1])
		return true
	}
	if (t === "Choose 1 of your active (League Militaire) Units and 1 enemy Unit that is Lv.3 or lower. Rest them.") {
		target = mySort(eu.filter(c => c.level <= 3), c => -c.AP())[0]
		if (!target) return false
		const friend = mySort(fu.filter(c => !c.rested && c.hasTrait("League Militaire")), c => c.AP())[0]
		if (!friend) return false
		rest(friend, {rester: card})
		rest(target, {rester: card})
		return true
	}
	if (t === "Deploy 1 rested [GQuuuuuuX (Omega Psycommu)]((Clan)･AP3･HP2) Unit token and 1 rested [Red Gundam]((Clan)･AP2･HP3) Unit token.") {
		if (fu.length >= 6) return false
		for (const token of ["GQuuuuuuX (Omega Psycommu)", "Red Gundam"]) {
			await p.deployToken(ctx, token, true)
		}
		return true
	}
	if (mo = t.match(/^[Dd]raw (\d).$/)) {
		// TODO: undo effect first? if (optional && p.deck.length < 1) return false
		await p.draw(mo[1])
		return true
	}
	if (t === "You may pay ①. If you do, draw 1. Then, discard 1.") {
		if (p.deck.length < 2) return false
		if (!await p.pay(1, card)) return false
		t = "draw 1. Then, discard 1."
	}
	if (mo = t.match(/^[Dd]raw (\d). Then, discard (\d).$/)) {
		// Attack/Deploy/Destroyed is not optional?! TODO: Maybe don't attack/deploy if low on cards.
		if (act === "Main" && (mo[1] >= p.deck.length || p.hand.length + mo[1] - mo[2] <= 0) && !card.hasTrait("Special Move")) return false
		await p.draw(mo[1])
		await p.discard(ctx, mo[2])
		return true
	}
	// When Paired
	if (t === "a Pilot with this Unit or one of your white Units, choose 1 enemy Unit. It gets AP-2 during this turn.") {
		if (!ctx.paired_unit || !ctx.paired_unit.color === "WHITE") return false
		targets = mySort(eu, c => -c.rested * 10 - c.AP())
		target = targets[0]
		if (!target) return false
		eotAP(target, -2)
		return true
	}
	if (mo = t.match(/^(and )?[Aa]dd it to your hand. If you do, discard 1./)) {
		toHand(target, true)
		await p.discard(ctx)
		return true
	}
	// When Linked
	if (mo = t.match(/^[Dd]raw (\d). If you do, discard (\d).$/)) {
		// not optional! if (p.deck.length < mo[1]) return false
		await p.draw(mo[1])
		// if dead, we don't reach here.
		await p.discard(ctx, mo[2])
		return true
	}
	// When Paired
	if (t === "Draw 1. Then, discard 1. If you discard a (Special Move) Command card with this effect, you may activate its [Main].") {
		await p.draw()
		targets = mySort(p.hand, c => - (c.type === "COMMAND") * 4 - c.hasTrait("Special Move") * 2 - inStr(c.text, "[Main]"))
		target = targets[0]
		let discarded = await p.discard(ctx, 1, [target])
		for (let c of discarded) {
			if (targets.includes(c)) {
				if (ai || await chooseCard([c], "Activate Main?")) await runCard(c, "Main")
			}
		}
		return true
	}
	if (t.slice(1) === "lace 1 EX Resource.") {
		// https://www.gundam-gcg.com/en/pdf/comprehensiverules_en.pdf?v#:~:text=You%20may%20have%20up%20to,view%20cards%20in%20this%20location.
		//log(`💲+1 EX Resource`)
		// if (p.resource.filter(item => !item.rested && item.name === "EX Resource").length >= 5) return false
		await p.placeEXResource()
		return true
	}
	if (mo = t.match(/[Tt]his Unit gets AP\+(\d+) during this turn./)) {
		eotAP(u, mo[1])
		return true
	}
	// Pilot Attack
	if (t === "This Unit gets AP+1 during this turn. If there are 7 or more (CB) cards in your trash, all your (CB) Units get AP+1 instead.") {
		if (p.trash.filter(c => c.hasTrait("CB")).length >= 7) {
			fu.filter(c => c.hasTrait("CB")).forEach(c => eotAP(c, 1))
		} else {
			eotAP(u, 1)
		}
		return true
	}
	if (t === "During this turn, this Unit gets AP+1 and, if it is a Link Unit, it gains <High-Maneuver>.") {
		eotAP(u, 1)
		if (linksWith(u, u.pilot)) eotKw(u, "High-Maneuver")
		return true
	}
	if (t === "You may deploy 1 (Neo Zeon)/(Zeon) Unit card that is Lv.4 or lower from your hand.") {
		target = mySort(p.hand.filter(item => item.level <= 4 && item.type === "UNIT" && (item.hasTrait("Neo Zeon") || item.hasTrait("Zeon"))), item => -item.COST())[0]
		if (!target || fu.length >= 6) return false
		await p.deploy(ctx, target)
		p.hand = p.hand.filter(item => item !== target)
		return true
	}
	if (mo = t.match(/^During this battle, your shield area cards can't receive damage from enemy Units that are Lv.(\d+) or lower.$/)) {
		if (!attacker || attacker.LEVEL() > mo[1]) return false
		p.kw_eob.push(`noDmgShield enemy.unit.lv${mo[1]}min`)
		return true
	}
	if (t === "All Units that are Lv.3 or lower other than Unit tokens are deployed rested.") {
		// Static effect handled in deploy(); return false to not print ran.
		return false
	}
	if (mo = t.match(/^It recovers (\d+) HP\. ?/)) {
		target = mySort(targets.filter(c => c.damage > 0), c => -c.damage)[0]
		if (!target) return false
		let would_draw = (t === "It recovers 2 HP. Then, draw 1.")
		if (t === "It recovers 2 HP. Then, if it is paired with a Pilot that is Lv.3 or lower, draw 1.") would_draw = (target.pilot && target.pilot.LEVEL() <= 3)
		if (would_draw && p.deck.length < 1) return false
		await target.recover(mo[1])
		if (would_draw) await p.draw()
		// TODO: Check for new items on card additions.
		return true
	}
	if (mo = t.match(/^It gets AP\+(\d+) during this turn.$/)) {
		target = mySort(targets.filter(c => !c.rested && !c.sick), c => c.AP())[0]
		if (!target) return false
		const strongest_enemy = mySort(eu, c => -c.HP())[0]
		const enemy_hp = strongest_enemy && strongest_enemy.AP() || 0
		const enemy_base_hp = (en.base && en.base.HP()) || 0
		if (Math.max(enemy_hp, enemy_base_hp) <= target.AP()) return false
		eotAP(target, 2)
		return true
	}
	if (clause === " Unit links, " && inStr(card.text, "When a friendly (Clan) Unit links, it gains <Breach 3> during this turn.")) {
		if (ctx.active_unit.owner !== u.owner || !ctx.active_unit.hasTrait("Clan")) return false
		eotKw(ctx.active_unit, "Breach 3")
		return true
	}
	// Attack ability is mandatory, hence "may".
	if (mo = t.match(/^(You may )?[Dd]iscard (\d). If you do, draw (\d).$/)) {
		if (mo[1] && p.deck.length < 1) return false
		let to_discard = parseInt(mo[2])
		if (p.hand.length < to_discard) return false
		await p.discard(ctx, to_discard)
		await p.draw(mo[3])
		return true
	}
	// Same for Deploy, mandatory trigger so gives a choice.
	if (t === "You may rest this Unit. If you do, choose 1 enemy Unit that is Lv.3 or lower. Deal 2 damage to it.") {
		target = chooseDmgTarget(u, eu.filter(c => c.LEVEL() <= 3), 2)
		if (!target) return false
		rest(u, {rester: card})
		await dealDamage(u, target, 2)
		return true
	}
	if (t === "you may return a blue Pilot paired with this Unit to its owner's hand.") {
		if (!u.pilot || u.pilot.color !== "BLUE" || u.HP() - u.pilot.HP() <= defender.AP() || u.AP() - u.pilot.AP() <= defender.HP()) return false
		if (p.getPairableUnits().length < 1 && !(inStr(u.pilot.text, "When Paired") || inStr(u.pilot.text, "When Linked"))) return false
		bounce(u.pilot)
		return true
	}
	// if (t === "2 friendly Units. They get AP+1 during this turn.") {
	// 	targets = fu.filter(c => (!myturn && c.rested) || !c.rested && !c.sick).slice(0, 2)
	// 	if (targets.length < 2 || (myturn && eu.filter(c => c.rested).length < 1 && !eu.base)) return false
	if (t === "1 to 3 of your (CB) Units. They get AP+2 during this turn.") {
		targets = fu.filter(c => c.hasTrait("CB") && !c.rested && !c.sick).slice(0, 3)
		// TODO: Might be worth to risk hitting a Burst-deployed BASE.
		if (targets.length < 1 || (eu.filter(c => c.rested).length < 1 && !eu.base)) return false
		targets.forEach(c => eotAP(c, 2))
		return true
	}
	if (t === "and 1 (UN) card from your trash. Exile them from the game. If you do, set this Unit as active. It can't attack during this turn.") {
		if (!u.rested) return false
		const target2 = p.trash.filter(c => c.hasTrait("UN"))[0]
		if (!target2) return false
		exile([target, target2])
		await activate(u)
		u.sick = true
		return true
	}
	if (t === "Pay its cost to deploy it.") {
		if (p.battle.length > 5) return false
		targets = targets.filter(c => c.LEVEL() < p.resource.length && c.COST() < p.resource.filter(c => !c.rested).length)
		target = targets[0]
		if (!target) return false
		if (!ai) target = await chooseCard(targets)
		if (!target) return false
		await p.pay(target.COST(), u)
		await p.deployFromTrash(ctx, target)
		return true
	}
	if (inStr(t, "It gains <First Strike> during this turn.")) {
		targets = mySort(targets.filter(c => !c.hasKw("First Strike")), c => c.AP())
		target = targets[0]
		if (!target || eu.length < 1 || (myturn && en.getProne(target).length < 1)) return false
		if (!myturn && defender && targets.includes(defender) && defender.AP() >= attacker.HP()) target = defender
		else return false
		eotKw(target, "First Strike")
		return true
	}
	// ST05-013
	if (mo = t.match(/^Deal 1 damage to it. It gets AP\+(\d) during this turn.$/)) {
		target = mySort(targets.filter(c => c !== u && !c.rested && !c.sick && c.HP() > 1), c => c.AP())[0]
		if (!target) return false
		await dealDamage(card, target)
		eotAP(target, mo[1])
		return true
	}
	// deploy
	if (t === "1 enemy Unit. Deal 1 damage to it. If it has <Repair>, deal 3 damage instead.") {
		targets = eu.filter(c => c.hasKw("Repair"))
		target = chooseDmgTarget(card, targets, 3, true)
		if (!target) target = chooseDmgTarget(card, eu, 1, true)
		if (!target) return false
		await dealDamage(card, target, target.hasKw("Repair") ? 3 : 1)
		return true
	}
	if (mo = t.match(/^you may pair 1 \((.+?)\) Pilot card from your hand with this Unit./)) {
		if (u.pilot) return false
		targets = p.hand.filter(c => c.type === "PILOT" && c.hasTrait(mo[1]))
		target = targets[0]
		if (!target) return false
		await pair(u, target)
		return true
	}

	// Activate･Main
	if (t === "Rest them. If you do, choose 1 enemy Unit. Deal 3 damage to it.") {
		target = chooseDmgTarget(card, eu, 3)
		if (!target) return false
		const mine = mySort(targets, c => -c.sick || c.AP()).slice(0, 2)
		if (mine.length < 2) return false
		rest(mine[0], {rester: card})
		rest(mine[1], {rester: card})
		await dealDamage(card, target, 3)
		return true
	}
	if (t === "①, rest 1 friendly (CB) Unit：Choose 1 enemy Unit that is Lv.5 or lower. Deal 1 damage to it.") {
		target = chooseDmgTarget(u, eu.filter(c => c.LEVEL() <= 5))
		if (!target) return false
		const mine = mySort(fu.filter(c => !c.rested && c.hasTrait("CB")), c => -c.sick || c.AP())[0]
		if (!mine) return false
		if (!await p.pay(1, u, true, t)) return false
		rest(mine)
		await dealDamage(u, target)
		return true
	}
	if (t === "①：Choose 1 enemy Unit with 2 or less AP. Deal 1 damage to it.") {
		target = chooseDmgTarget(card, eu.filter(c => c.AP() <= 2))
		if (!target) return false
		if (!await p.pay(1, card, true, t)) return false
		await dealDamage(card, target)
		return true
	}
	if (t === "①：Choose 1 Unit that is Lv.4 or higher. It gets AP+1 during this battle.") {
		target = [attacker, defender].filter(c => c && c.owner === p && c.LEVEL() >= 4)
		if (!target) return false
		if (!await p.pay(1, u, true, t)) return false
		eobAP(target)
		return true
	}
	if (t === "1 of your other Units. Deal 1 damage to it. It gets AP+1 during this turn.") {
		target = mySort(fu.filter(c => c !== u && (myturn ? !c.rested && !c.sick : c === defender || c.rested || c.hasKw("Blocker")) && c.HP() > 1), c => c.AP())[0]
		if (!target) return false
		await dealDamage(card, target)
		eotAP(target, 1)
		return true
	}
	if (t === "It can't receive battle damage from enemy Units with 2 or less AP during this battle. If you are Lv.7 or higher, it can't receive battle damage from enemy Units with 5 or less AP instead.") {
		if (p.resource.length >= 7) t = "It can't receive battle damage from enemy Units with 5 or less AP during this battle."
		else t = "It can't receive battle damage from enemy Units with 2 or less AP during this battle."
	}
	if (mo = (t.match(/^[Ii]t can't receive battle damage from enemy Units with (\d+) or less (AP|HP) during this (battle|turn).$/))) {
		if (mo[3] === "battle") {
			if (attacker && attacker.owner === p) target = attacker
			else if (defender && defender.owner === p) target = defender
			else return false
		}
		const enemies = mo[2] === "AP" ? eu.filter(c => c.AP() <= mo[1]) : eu.filter(c => c.HP() <= mo[1])
		if (!target || enemies.length < 1) return false
		eobKw(target, `noDmg enemy.unit.${mo[2].toLowerCase()}${mo[1]}min`)
		return true
	}
	if (mo = t.match(/^They get AP\+(\d+) during this turn.$/)) {
		if (myturn) targets = mySort(targets.filter(c => !c.sick && !c.rested), c => c.AP())
		else targets = targets.filter(c => c.rested)
		if (targets.length < 1) return false
		for (const target of targets) eotAP(target, mo[1])
		return true
	}
	// When Paired
	// Unit
	if (t === "Deal 1 damage to it. When this effect destroys an enemy Unit, draw 1.") {
		await dealDamage(u, target)
		if (!en.battle.includes(target)) await p.draw()
		return true
	}
	if (t === "Deploy 2 [Wire-Guided Arm]((Zeon)･AP2･HP1・This Unit can't be paired with a Pilot) Unit tokens.") {
		await p.deployToken(ctx, "Wire-Guided Arm")
		await p.deployToken(ctx, "Wire-Guided Arm")
		return true
	}
	if (t === "deploy 2 rested [Ad Balloon]((Civilian)･AP0･HP1･This Unit can't be set as active or paired with a Pilot) Unit tokens.") {
		[..."12"].forEach(async c => { await p.deployToken(ctx, "Ad Balloon", true) })
		return true
	}
	if (t === "Return it to its owner's hand.") {
		target = mySort(targets, c => -c.cost + c.rested)[0]
		return bounce(target)
	}
	// Pilot
	if (t === "1 of your (Mafty) Units. During this turn, it may choose a damaged active enemy Unit as its attack target.") {
		target = fua.filter(c => c.hasTrait("Mafty"))[0]
		if (!target) return false
		eotKw(target, "canAttack active.unit.damaged")
		return true
	}
	if (t === "it may choose an active enemy Unit whose Lv. is equal to or lower than this Unit as its attack target during this turn.") {
		eotKw(u, `canAttack active.unit.lv${card.level}min`)
		return true
	}
	if (t === "All your (Cyclops Team) Units may choose an active enemy Unit with 5 or less AP as their attack target during this turn.") {
		fu.forEach(c => c.hasTrait("Cyclops Team") && eotKw(c, `canAttack active.unit.ap5min`))
		return true
	}
	if (t === "1 of your Resources. Set it as active.") {
		targets = p.resource.filter(c => c.rested)
		if (targets.length > 0) await activate(targets[0], true)
		return true
	}
	if (inStr(t, "Deploy 1 [Hy-Gogg]((Cyclops Team)･AP2･HP1) Unit token.")) {
		if (fu.length >= 6) return false
		await p.deployToken(ctx, "Hy-Gogg")
		return true
	}
	if (t === "If you have another Link Unit in play, draw 1.") {
		if (!fu.some(c => c !== card && c.linked())) return false
		await p.draw()
		return true
	}
	// When Linked
	if (t === "Place the top card of your deck into your trash. If you placed a (Zeon)/(Clan) card with this effect, choose 1 enemy Unit. Deal 1 damage to it.") {
		target = p.mill()[0]
		if (target.hasTrait("Zeon") || target.hasTrait("Neo Zeon")) {
			target = chooseDmgTarget(u, eu)
			if (!target) return false
			await dealDamage(u, target)
			return true
		}
		return false
	}
	if (mo = t.match(/^[Tt]his Unit gains <(.+?)> during this battle\.$/)) {
		eobKw(u, mo[1])
		return true
	}
	if (mo = t.match(/^[Tt]his Unit gains <(.+?)> during this turn\.$/)) {
		eotKw(u, mo[1])
		return true
	}
	if (mo = t.match(/^[Ii]t gains <(Repair \d+)> during this turn. ?/)) {
		t = t.slice(mo[0])
		if (t === "Then, if it is a (Jupitris) Unit, draw 1.") {
			target = mySort(targets, c => -c.damage - c.hasTrait("Jupitris"))[0]
			if (target.hasTrait("Jupitris")) await p.draw()
		} else target = mySort(targets, c => -c.damage)[0]
		if (!target) return false
		eotKw(target, mo[1])
		return true
	}
	if (t === "During this turn, battle damage it would receive is dealt to this Unit instead.") {
		log(`🎯Battle damage target: ${target}`)
		eotKw(target, "redirect_battle_damage " + card.cid)
		return true
	}
	if (t === "During this turn, reduce the next damage it receives by 2.") {
		eotHP(target, 2)
		return true
	}

	if (clause === "play and activate") {
		if (t === " an (Academy) Command card using an EX Resource, if you have no remaining EX Resources, place 1 rested EX Resource.") {
			if (spent.length < 1 || !ctx.active_card.traits.includes("Academy") || p.resource.filter(c => inStr(c.name, "EX")).length > 0) return false
			await p.placeEXResource(true)
			return true
		}
	}
	if (clause === "receives battle damage" && t === " from an enemy Unit with 3 or less AP, deal 1 damage to that Unit.") {
		if (!attacker || attacker.AP() > 3) return false
		await dealDamage(u, attacker)
		return true
	}
	if (clause === "receives damage") {
		if (ctx.active_damage < 1) {
			log("FIXME: no damage to receive", false, true, true)
			return false
		}
		if (inStr(t, " from an enemy, ") && ctx.active_card.owner === p) return false
		if (t === " from an enemy, reduce it by 1.") {
			log(`⚡${card} ${card.text}`)
			ctx.active_damage -= 1
			return true
		}
		if (inStr(card.text, "If you have a (CB) Pilot in play, when this Unit receives damage from an enemy, reduce it by 1.")) {
			if (!fu.battle.some(c => c.pilot && c.pilot.hasTrait("CB"))) return false
			log(`⚡${card} ${card.text}`)
			ctx.active_damage -= 1
			return true
		}
		// TODO: Check if reduced to zero damage still counts.
		if (t === " from an enemy, place 1 EX Resource.") {
			let rule = " when one of your other (Academy) Units receives damage from an enemy, place 1 EX Resource."
			if (ctx.active_target.owner !== p || !ctx.active_target.traits.includes("Academy")) return false
			log(`⚡${card} ${rule}`)
			await p.placeEXResource()
			return true
		}
	}

	if (mo = t.match(/^[Pp]lace (\d) (rested )?(EX )?Resources?\. ?/)) {
		for (let i = 0; i < mo[1]; ++i) {
			if (mo[3]) await p.placeEXResource(!!mo[2])
			else {
				/*Is there a maximum number of cards that can be in the resource area? Yes, there is. Up to 10 Resource cards from the resource deck and 5 EX Resource cards can be placed into the resource area, for a total of 15 cards.*/
				let r = p.resource_deck.pop()  // p.getCard("R-00" + rnd(4, 9))
				if (!r) continue
				if (mo[2]) r.rested = true
				p.resource.push(r)
			}
		}
		t = t.slice(mo[0].length)
		if (t === "Then, this Unit gains <First Strike> during this turn.") {
			eotKw(u, "First Strike")
			return true
		}
		if (t === "") return true
	}

	if (t === "If you have another (Cyclops Team) Unit in play, deploy 1 rested [Hy-Gogg]((Cyclops Team)･AP2･HP1) Unit token.") {
		if (!fu.some(c => c !== u && c.hasTrait("Cyclops Team"))) return false
		await p.deployToken(ctx, "Hy-Gogg", true)
		return true
	}
	if (t === "If you have another (UN)/(Superpower Bloc) Unit in play, deploy 1 rested [Alvaaron]((UN)･AP4･HP1) Unit token.") {
		if (!fu.some(c => c !== u && c.hasTrait("UN") || c.hasTrait("Superpower Bloc"))) return false
		await p.deployToken(ctx, "Alvaaron", true)
		return true
	}

	// [Main]/[Action]
	if (inStr(t, "If you have no (Earth Alliance) Unit tokens in play,")) {
		if (fu.filter(c => c.isToken() && c.hasTrait("Earth Alliance")).length > 0) return false
		if (inStr(t, "deploy 1 [Sword Strike Gundam]((Earth Alliance)･AP4･HP2･<Blocker>) or 1 [Launcher Strike Gundam]((Earth Alliance)･AP2･HP4･<Blocker>) Unit token.")) {
			await p.deployToken(ctx, "Sword Strike Gundam")
			return true
		}
		if (inStr(t, "deploy 1 [Aile Strike Gundam]((Earth Alliance)･AP3･HP3･<Blocker>) Unit token.")) {
			await p.deployToken(ctx, "Aile Strike Gundam")
			return true
		}
	}

	if (t === "All enemy Units get AP-1 during this turn.") {
		eu.forEach(item => eotAP(item, -1))
		return true
	}
	let dmg_to_target = 0
	if (mo = t.match(/^[Dd]eal (\d+) damage to /)) {
		let dmg_to_target = parseInt(mo[1])
		t = t.slice(mo[0].length)
		targets = []
		if (t === "all enemy Units.") {
			targets = eu
		}
		if (t === "all Bases.") {
			if (!en.base) return false
			targets = [en.base, p.base]
		}
		if (mo = t.match(/^all Units with <(.+?)> that are Lv.(\d+) or lower.$/)) {
			targets = fu.concat(eu).filter(c => c.hasKw(mo[1]) && c.LEVEL() <= mo[2])
		}
		if (targets.length < 1) return false
		targets.forEach(async c => await dealDamage(card, c, dmg_to_target))
		return true
	}

	// At the end of the turn
	if (t === "when this Unit is paired with a Pilot, set it as active.") {
		if (!u.pilot || !u.rested) return false
		await activate(u, true)
		return true
	}
	// Attack trigger
	if (t === "If this Unit is attacking the enemy player, reveal 1 (Earth Federation) Unit card from your hand. Return it to the bottom of your deck. If you do, draw 2.") {
		if (eu.includes(defender)) return false
		target = p.hand.filter(c => c.hasTrait("Earth Federation"))[0]
		if (!target) return false
		p.hand = p.hand.filter(c => c !== target)
		p.deck = [target].concat(p.deck)
		await p.draw(2)
		return true
	}
	if (t === "If this Unit is attacking an enemy Unit, choose 1 enemy Unit. Deal 1 damage to it.") {
		if (!eu.includes(defender)) return false
		target = chooseDmgTarget(u, u.AP() >= defender.HP() ? eu.filter(c => c === defender) : eu, 1, true)
		await dealDamage(card, target)
		return true
	}
	if (t === "If this Unit is damaged and Lv.5 or lower, it gains <High-Maneuver> during this battle.") {
		if (u.damage < 1 || u.LEVEL() > 5) return false
		eobKw(u, "High-Maneuver")
		return true
	}
	if (mo = t.match(/^[Dd]eal 1 damage to all (enemy )?Units that are Lv.(\d) or lower.$/)) {
		targets = mo[1] ? eu.filter(c => c.LEVEL() <= mo[2]) : eu.concat(fu).filter(c => c.LEVEL() <= mo[2])
		if (targets.length < 1) return false
		targets.forEach(async target => await dealDamage(card, target))
		return true
	}
	if (mo = t.match(/^[Dd]eal 1 damage to all enemy Units with <(.+?)> that are Lv.(\d) or lower.$/)) {
		targets = eu.filter(c => c.LEVEL() <= mo[2] && c.hasKw(mo[1]))
		if (targets.length < 1) return false
		targets.forEach(async target => await dealDamage(card, target))
		return true
	}
	if (t === "Deal 1 damage to all enemy Units other than Link Units.") {
		targets = eu.filter(c => !c.linked())
		if (targets.length < 1) return false
		targets.forEach(async target => await dealDamage(card, target))
		return true
	}
	if (t === "If there are 5 or more purple cards in your trash, deal 2 damage to all Units with 5 or less AP.") {
		targets = p.trash.filter(c => c.color === "PURPLE")
		if (targets.length < 5) return false
		eu.concat(fu).filter(c => c.AP() <= 5).forEach(async target => await dealDamage(u, target, 2))
		return true
	}
	if (t === "If there are 10 or more (Zeon)/(Neo Zeon) Unit cards in your trash, deal 4 damage to all Units with <Blocker>.") {
		targets = p.trash.filter(c => c.hasTrait("Zeon") || c.hasTrait("Neo Zeon"))
		if (targets.length < 10) return false
		eu.concat(fu).filter(c => c.hasKw("Blocker")).forEach(async target => await dealDamage(card, target, 4))
		return true
	}
	// Deploy
	if (t === "All players place 1 EX Resource.") {
		for (let player of [p, en]) await player.placeEXResource()
		return true
	}
	if (mo = t.match(/[Yy]ou may deploy 1 \((.+?)\) Unit card (that is Lv.4 or lower )?from your hand./)) {
		if (fu.length > 5) return false
		target = p.hand.filter(c => c.isUnit() && c.hasTrait(mo[1]) && (mo[2] ? c.LEVEL() <= 4 : true))[0]
		if (!target) return false
		await p.deploy(ctx, target)
		return true
	}
	if (t === "you may destroy this Unit. If you do, deploy 3 [Gundam Exia]((G Generation)･AP2･HP2) Unit tokens.") {
		if (p.battle.length <= 4 && u.rested && p.hand.length < 1) {
			ctx = {...ctx, destroyer: card}
			await destroy(u, ctx)
			for (let i = 0; i < 3; ++i) {
				await p.deployToken(ctx, "Gundam Exia")
			}
			return true
		}
		return false
	}
	if (t === "Rest them. If you do, deal damage equal to the number of Units rested with this effect to all enemy Units that are Lv.6 or lower.") {
		let their = mySort(eu.filter(c => c.LEVEL() <= 6), c => -c.HP())
		if (their.length < 1) return false
		const maxDamage = their[0].HP()
		const mine = targets.slice(0, maxDamage < 2 ? 1 : 2)
		if (mine.length < 1) return false
		mine.forEach(c => rest(c, {rester: card}))
		their.forEach(async c => await dealDamage(u, c, mine.length))
		return true
	}
	if (t === "Destroy it. If you do, all enemy players each choose 1 of their non-battling Units. Destroy them.") {
		if (eu.length < 1) return false
		targets = mySort(targets, c => c.AP() - c.rested)
		target = targets[0]
		if (!ai) target = await chooseCard(targets)
		if (!target) return false
		ctx = {...ctx, destroyer: card}
		await destroy(target, ctx)

		targets = mySort(eu.filter(c => ![attacker, defender].includes(c)), c => c.AP() - c.rested)
		target = targets[0]
		if (!target) return false
		if (!ai) target = await chooseCard(targets)
		if (!target) return false
		await destroy(target, ctx)

		return true
	}
	if (t === "Destroy it. If you do, choose 1 enemy Unit that is Lv.4 or lower. Deal 2 damage to it.") {
		let mine = mySort(targets.filter(c => c.rested), c => c.AP())[0]
		if (!mine) return false
		target = chooseDmgTarget(u, eu.filter(c => c.LEVEL() <= 4), 2)
		if (!target || mine.AP() > target.AP()) return false
		ctx = {...ctx, destroyer: card}
		await destroy(mine, ctx)
		await dealDamage(card, target, 2)
		return true
	}
	if (t === "Deal 1 damage to this Unit. If you do, choose 1 enemy Unit with 3 or less AP. Rest it.") {
		// deploy, so mandatory
		if (!await dealDamage(card, u)) return false
		target = mySort(eu.filter(c => c.AP() <= 3), c => -c.AP())[0]
		if (!target) return false
		rest(target, {rester: card})
		return true
	}
	if (mo = t.match(/^Choose 1 damaged enemy Unit. Deal (\d) damage to it.$/)) {  // TODO: damaged in main choose regex
		let amount = parseInt(mo[1])
		target = chooseDmgTarget(u, eu.filter(c => c.damage > 0), amount)
		if (!target) return false
		return await dealDamage(card, target, amount)
	}
	if (mo = t.match(/^Choose 1 enemy Unit with (\d) or less HP. Rest it.$/)) {
		target = mySort(eu.filter(c => c.HP() <= mo[1] && !c.rested), c => -c.AP())[0]
		if (!target) return false
		rest(target, {rester: card})
		return true
	}
	if (t === "Rest 1 of your other (League Militaire) Units：Choose 1 enemy Unit with 4 or less HP. Rest it.") {
		const mine = fu.filter(c => c !== u && !c.rested && c.hasTrait("League Militaire"))[0]
		target = mySort(eu.filter(c => c.HP() <= 4 && !c.rested), c => -c.AP())[0]
		if (!mine || !target) return false
		rest(mine)
		rest(target, {rester: card})
		return true
	}

	if (t === "During this turn, it may choose an active enemy Unit as its attack target.") {
		eotKw(u, "canAttack active.unit.lv9min")
		return true
	}
	if (t === "During this turn, this Unit may choose an active enemy Unit that is Lv.5 or lower as its attack target.") {
		eotKw(u, "canAttack active.unit.lv5min")
		return true
	}
	// When linked, so not optional
	if (inStr(t, "During this turn, this Unit may choose an active enemy Unit with AP equal to or less than this Unit as its attack target.")) {
		if (!myturn) return false
		eotKw(u, "canAttack active.unit.apEqmin")
		return true
	}
	if (mo = t.match(/^During this turn, it may choose an active enemy Unit that is Lv.(\d+) or lower as its attack target.$/)) {
		target = targets.filter(c => fua.includes(c))[0]
		if (!myturn || !target || !eu.some(c => !c.rested && c.LEVEL() <= mo[1])) return false
		eotKw(u, `canAttack active.unit.lv${mo[1]}min`)
		return true
	}
	// damage trigger
	if (t === "reduce it by 2.") {
		card.effect_damage = Math.max(0, card.effect_damage - 2)
		return true
	}

	if (t === "All your Units get AP+2 during this turn.") {
		if (fu.length < 1 || (eu.filter(c => c.rested).length < 1 && !en.base)) return false
		fu.forEach(c => eotAP(c, 2))
		return true
	}
	// deploy
	if (t === "During this turn, when one of your (Earth Federation) Units destroys an enemy Unit with battle damage, choose 1 enemy Unit with 5 or less HP. Rest it.") {
		targets = fu.filter(c => c.hasTrait("Earth Federation"))
		/* A new Unit is deployed after the effect "all your Units get AP+2 during this turn" has activated. At this time, does the newly deployed Unit also get AP+2?

		No, it does not. Effects that bestow some effect on all Units are only applied to Units that were in the battle area at that time. */
		if (targets.length < 1) return false
		targets.forEach(c => eotKw(c, "When this destroys an enemy Unit with battle damage, choose 1 enemy Unit with 5 or less HP. Rest it."))
		return true
	}
	if (t === "When it destroys an enemy Unit with battle damage during this turn, if you have 3 or less cards in your hand, draw 1.") {
		target = fua.filter(c => targets.includes(c))[0]
		if (!target) return false
		eotKw(target, "When this destroys an enemy Unit with battle damage, if you have 3 or less cards in your hand, draw 1.")
		return true
	}
	if (t === "with battle damage during this turn, if you have 3 or less cards in your hand, draw 1.") {
		// Not the chosen card.
		return false
	}
	if (t === "During this turn, when they destroy an enemy card with battle damage, draw 1.") {
		// TODO: Maybe better targets. Also, are pilots and shields cards?
		targets.forEach(c => eotKw(c, "When this destroys an enemy card with battle damage, draw 1."))
		return true
	}
	//if  publish(" destroys an enemy card with battle damage, ", [att]) await p.draw()
	if (t === "You may discard 2. If you do, choose 1 enemy Unit with the lowest Lv. Return it to the bottom of its owner's deck.") {
		target = mySort(eu, c => c.LEVEL() * 100 - c.AP())[0]
		if (!target) return false
		if (p.hand.length < 2) return false
		if ((await p.discard(ctx, 2, p.hand, true)).length !== 2) return false
		en.deck = [target].concat(en.deck.slice(0, -1))
		return true
	}
	// destroys trigger
	if (t === "if you have 3 or less cards in your hand, draw 1.") {
		if (p.hand.length > 3) return false
		await p.draw()
		return true
	}
	if (t === "that friendly Unit may recover 2 HP." && card.id === "GD03-125") {
		if (!myturn || ctx.destroyer.level < 6 || !(ctx.destroyer.hasTrait("Operation Meteor") || ctx.destroyer.hasTrait("G Team"))) return false
		await ctx.destroyer.recover(2)
		return true
	}
	if (t === "deal 2 damage to all enemy Units with <Blocker>.") {
		targets = eu.filter(c => c.hasKw("Blocker"))
		if (targets.length < 1) return false
		targets.forEach(async target => await dealDamage(card, target, 2))
		return true
	}
	if (t === "paired with a (Newtype) Pilot with battle damage, draw 1.") {
		// TODO: Check if battle damage?
		let enemy = u === attacker ? defender : attacker
		if (!enemy || !enemy.pilot || !enemy.pilot.hasTrait("Newtype")) return false
		await p.draw()
		return true
	}
	if (t === "that enemy player may discard 1. If they don't discard with this effect, you may deploy 1 (Phantom Pain) Unit card that is Lv.4 or lower from your hand.") {
		let discarded = await en.discard(ctx, 1, en.hand, true)
		if (discarded && discarded.length > 0) return true
		targets = p.hand.filter(c => c.hasTrait("Phantom Pain") && c.type === "UNIT" && c.LEVEL() <= 4)[0]
		if (!target) return false
		await p.deployFromHand(ctx, target)
		return true
	}

	if (t.match(/Add it to your hand.$/)) {
		if (mo = t.match(/^1 \((.+?)\) (Base|Command|Pilot|Unit) card from your trash. Add it to your hand.$/)) {
			targets = p.trash.filter(c => c.type === mo[2].toUpperCase() && c.hasTrait(mo[1]))
		}
		else if (t === "1 Pilot card with \"Shinn Asuka\" in its card name from your trash. Add it to your hand.") {
			targets = p.trash.filter(c => c.type === "PILOT" && inStr(c.name, "Shinn Asuka"))
		}
		else if (t === "Exile them from the game. If you do, choose 1 (Special Move) Command card from your trash. Add it to your hand.") {
			target = p.trash.filter(c => c.type === "COMMAND" && c.hasTrait("Special Move"))[0]
			if (!target) return false
			exile(targets)
			toHand(target, true)
			return true
		}
		if (targets.length < 1) {
			log(`FIXME: No targets for ${card.id}: ${t}`, true, true, true)
		}
		target = targets[0]
		if (!target) return false
		if (!ai) target = await chooseCard(targets)
		if (!target) return false
		toHand(target, true)
		return true
	}
	if (t === "Draw a number of cards equal to the number of enemy players. Then, discard the same number of cards you drew with this effect.") {
		// TODO: 3+ players
		if (p.hand.length < 1) return false
		await p.draw()
		await p.discard(ctx, 1)
		return true
	}
	if (mo = t.match(/^Place the top (\d+) cards of your deck into your trash\.$/)) {
		p.mill(mo[1])
		return true
	}
	if (t === "Place the top 2 cards of your deck into your trash. If you place a (CB) card with this effect, draw 1.") {
		const top = card.owner.mill(2)
		if (top.some(c => c.hasTrait("CB"))) await p.draw()
		return true
	}
	if (t === "Place the top 2 cards of your deck into your trash. If you do, choose 1 enemy Unit with 4 or less AP. Deal an amount of damage equal to the number of (Minerva Squad) cards placed with this effect to that enemy Unit.") {
		if (card.owner.deck.length < 2 || !eu.some(c => c.AP() <= 4)) return false
		const top = card.owner.mill(2)
		const dmg = top.filter(c => c.hasTrait("Minerva Squad")).length
		if (dmg > 0) {
			target = chooseDmgTarget(u, eu.filter(c => c.AP() <= 4), dmg)
			if (!target) return true
			await dealDamage(card, target, dmg)
		}
		return true
	}
	if (t === "You may discard 1 green (Earth Federation) Unit card. If you do, place 1 EX Resource. Then, if you are Lv.7 or higher, draw 1.") {
		targets = p.hand.filter(c => c.color === "GREEN" && c.hasTrait("Earth Federation"))
		target = targets[0]
		if (!target) return false
		if (p.resource.length >= 7 && p.deck.length < 1) return false
		let discarded = await p.discard(ctx, 1, targets, true)
		if (!discarded || discarded.length < 1) return false
		await p.placeEXResource()
		if (p.resource.length >= 7) await p.draw()
		return true
	}
	if (t === "you may discard 1 red card. If you do, draw 1.") {
		targets = p.hand.filter(c => c.color === "RED")
		if (targets.length < 1 || p.deck.length < 1) return false
		let discarded = await p.discard(ctx, 1, targets)
		if (discarded.length < 1) return false
		await p.draw()
		return true
	}
	if (mo = t.match(/^All players each look at the top card of their deck. If it is /)) {
		t = t.slice(mo[0].length)
		for (let player of [p, en]) {
			let top = p.deck.slice(-1)[0]
			if (!top) continue
			if (t === "a Unit card, they may reveal it and add it to their hand. They return any remaining card to the top or bottom of their deck." && top.isUnit()
				|| t === "a card that is Lv.5 or higher, they may reveal it and add it to their hand. They return any remaining card to the top or bottom of their deck." && top.LEVEL() >= 5) {
				player.deck.pop()
				toHand(top)
			} else if (!player.canUse(top)) {
				log(`${player} put top card on bottom`)
				player.deck = [top].concat(player.deck.slice(0, -1))
			}
		}
		return true
	}
	let look = 0
	if (mo = t.match(/^You may discard 1. If you do, /)) {
		if (t.match(/^You may discard 1. If you do, look at the top 3 cards of your deck./)) {
			if (p.hand.length < 1) return false
			await p.discard(ctx)
			look = 3
			t = t.slice(mo[0].length)
		}
	}
	if (mo = t.match(/^[Ll]ook at the top (\d+) cards of your deck\.? ?/)) {
		look = mo[1]
		t = t.slice(mo[0].length)
	}
	if (mo = t.match(/^[Ll]ook at the top card of your deck\.? ?/)) {
		look = 1
		t = t.slice(mo[0].length)
	}
	if (look > 0) {
		if (p.deck.length < 2) return false
		if (inStr(t, "may deploy") && fu.length >= 6) return false
		targets = p.deck.slice(-look)
		if (targets.length < look) return false
		let action = "unknown"
		if (mo = t.match(/ Return the remaining cards randomly to the bottom of your deck\.$/)) {
			action = "shuffle"
			t = t.slice(0, -mo[0].length)
		}
		let target = null
		if (t === "and return 1 to the top and 1 to the bottom.") {
			if (!p.canUse(targets[1])) {
				log("🎴Top to bottom")
				p.deck = [targets[1]].concat(p.deck.slice(0, -1))
			} else {
				log("🎴2nd to bottom")
				p.deck = [targets[0]].concat(p.deck.slice(0, -2)).concat(targets[1])
			}
			return true
		}
		if (t === "and return 1 to the top. Return the remaining cards to the bottom of your deck. Then, if you have a (Newtype) Pilot in play, draw 1.") {
			for (target of targets) {
				if (p.canUse(target)) break
			}
		}
		if (t === "and return 1 to the top. Place the remaining card into your trash.") {
			if (!p.canUse(targets[1])) {
				log("🗑️" + p.name + " trashes " + targets[1])
				trash(targets[1])
				p.deck = p.deck.slice(0, -1)
			} else {
				log("🗑️" + p.name + " trashes " + targets[0])
				trash(targets[0])
				p.deck = p.deck.slice(0, -2).concat(targets[1])
			}
			return true
		}

		if (inStr(t, "If it is a (Zeon)/(Neo Zeon) Unit card, you may reveal it and add it to your hand.")) {
			target = targets.filter(c => c.type === "UNIT" && (c.hasTrait("Zeon") || c.hasTrait("Neo Zeon")))[0]
		}
		if (mo = t.match(/^If it is a \((.+?)\) card, you may reveal it and add it to your hand./)) {
			for (const part of mo[1].split(")/(")) {
				target = targets.filter(c => c.hasTrait(mo[1]))[0]
				if (target) break
			}
		}
		// TODO: target = for non-ai
		if (mo = t.match(/^You may reveal 1 \(([^)]+?)\) (Base|Command|Pilot|Unit) card among them and add it to your hand./)) {
			target = targets.filter(c => c.type === mo[2].toUpperCase() && c.hasTrait(mo[1]))[0]
		}
		else if (mo = t.match(/^You may deploy 1 \((.+?)\) Unit card that is Lv.4 or lower among them./)) {
			target = targets.filter(c => c.type === "UNIT" && c.level <= 4 && c.hasTrait(mo[1]))[0]
		}
		else if (mo = t.match(/^You may reveal 1 (Base|Command|Pilot|Unit) card among them and add it to your hand./)) {
			target = targets.filter(c => c.type === mo[1].toUpperCase())[0]
		}
		else if (inStr(t, "You may reveal 1 (Academy) Unit card/Command card among them and add it to your hand.")) {
			target = targets.filter(c => (c.type === "UNIT" || c.type === "COMMAND") && c.hasTrait("Academy"))[0]
		}
		if (mo = t.match(/^You may reveal 1 \((.+?)\) Unit card\/Pilot card among them and add it to your hand./)) {
			target = targets.filter(c => (c.type === "UNIT" || c.type === "PILOT") && c.hasTrait(mo[1]))[0]
		}
		else if (mo = t.match(/You may reveal 1 \((.+?)\) Unit card that is Lv.(\d+) (or lower )?among them and add it to your hand./)) {
			targets = targets.filter(c => c.type === "UNIT" && c.LEVEL() <= mo[2] && c.hasTrait(mo[1]))
			if (!mo[3]) targets = targets.filter(c => c.LEVEL() === mo[3])
			target = targets[0]
		}
		else if (inStr(t, "You may reveal 1 green (Zeon) Pilot card among them and add it to your hand.")) {
			target = targets.filter(c => c.type === "PILOT" && c.color === "GREEN" && c.hasTrait("Zeon"))[0]
		}
		// TODO: /reveal (\d) (\(.*?\)) ((Unit|Pilot|Base|Command) card\/?)+/ card among them
		else if (inStr(t, "You may reveal 1 green (Earth Federation) Unit card/1 card with \"AGE Device\" in its card name among them and add it to your hand.")) {
			target = targets.filter(c => inStr(c.nme, "AGE Device") || (c.type === "UNIT" && c.color === "GREEN" && c.hasTrait("Earth Federation")))[0]
		}
		else if (inStr(t, "You may reveal 1 (Zeon)/(Neo Zeon) Unit card among them and add it to your hand.")) {
			target = targets.filter(c => c.hasTrait("Zeon") || c.hasTrait("Neo Zeon"))[0]
		}
		else if (inStr(t, "You may reveal 1 (Clan) Unit card/Pilot card among them and add it to your hand.")) {
			target = targets.filter(c => c.hasTrait("Clan") && (c.type === "UNIT" || c.type === "PILOT"))[0]
		}
		else if (t === "You may reveal 1 (G Generation) Unit card among them and return it to the top of your deck.") {
			target = targets.filter(c => c.hasTrait("G Generation"))[0]
		}
		else if (inStr(t, "You may reveal 1 (Operation Meteor)/(G Team) Unit card/Pilot card among them and add it to your hand.")) {
			target = targets.filter(c => (c.hasTrait("Operation Meteor") || c.hasTrait("G Team")) && (c.type === "UNIT" || c.type === "PILOT"))[0]
		} else if (t === "Return it to the top or bottom of your deck.") {
			const c = targets[0]
			// TODO: Untapped resource length?
			if ((c.LEVEL() < p.resource.length && c.COST() < p.resource.length) &&
				(c.type === "BASE" && !p.base
					|| (c.type === "UNIT" && p.battle.length < 6)
					|| (c.type === "PILOT" && fu.some(c2 => !c2.pilot && linksWith(c, c2)))
				)) target = c
		} else if (t === "Return it to the top of your deck or place it into your trash.") {
			target = targets[0]
			// TODO: Choose top or trash
			trash(target)
		} else if (target === null) {
			log(`🚩🚩FIXME: No target for ${card.type} ${card.id} ${act}${clause} "${t}". p battle length: ${p.battle.length}`, true, true, true)
			return false
		}

		if (target) {
			if (inStr(t, "reveal")) log(`🎴${p.name} reveals from top ${look}: ${target}`)
			if (inStr(t, "add it to your hand")) {
				toHand(target)
			} else if (inStr(t, "You may deploy")) {
				// try {
				await p.deploy(ctx, target)
				// } catch (ex) {
				// 	log(`🚩🚩FIXME: ${ex} with card ${card} targets ${targets} target ${target} t ${t}`)
				// 	debugger
				// }
			}
			targets = targets.filter(c => c !== target)
		}
		log(`🎴${p.name} puts ${targets.length} shuffled cards on bottom`)
		shuffle(targets)
		p.deck = targets.concat(p.deck.slice(0, -look))

		if (target && (mo = t.match(/ and return it to the top of your deck.$/))) {
			p.deck.push(target)
		}
		if (t === "and return 1 to the top. Return the remaining cards to the bottom of your deck. Then, if you have a (Newtype) Pilot in play, draw 1.") {
			p.deck.push(target)
			if (p.battle.some(c => c.pilot && c.pilot.hasTrait("Newtype"))) await p.draw()
		}
		return true
	}

	// Destroyed
	if (t === "You may exile this card in your trash from the game. If you do, you may deploy 1 Base card with \"Presidential Office\" in its card name from your hand.") {
		target = p.hand.filter(c => c.type === "BASE" && inStr(c.name, "Presidential Office"))[0]
		if (!target || p.base) return false
		exile([card])
		await p.deploy(ctx, target)
		return true
	}
	if (t === "If you have an (Orb) Pilot in play, draw 1.") {
		if (!fu.some(c => c.pilot && c.pilot.hasTrait("Orb"))) return false
		await p.draw()
		return true
	}
	if (t === "Return the card paired with this Unit to your hand.") {
		if (!u.pilot) return false
		toHand(u.pilot)
		u.pilot = null
		return true
	}
	if (t === "return this Unit's paired Pilot to its owner's hand.") {
		if (!u.pilot) return false
		toHand(u.pilot)
		u.pilot = null
		return true
	}
	if (t === "All players draw 1.") {
		if (p1.deck.length < 1 && p2.deck.length < 1) throw Error("Draw by empty decks.")
		await p1.draw()
		await p2.draw()
		return true
	}
	if (t === "If it is your opponent's turn and this is a (CB) Unit, draw 1.") {
		if (myturn || !u.hasTrait("CB")) return false
		await p.draw()
		return true
	}

	if (clause === "hen you pay ") {
		// ⓪ ① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩
		// not dingbat circled sans-serif 🄋 ➀ ➁ ➂ ➃ ➄ ➅ ➆ ➇ ➈ ➉
		if (t === "① or more for a friendly Unit's effect, this Base recovers 2 HP.") {
			if (!ctx.active_text || ctx.active_cost < 1 || !ctx.active_unit.isUnit() || ctx.active_unit.owner !== p) return false
			await u.recover(2)
			return true
		}
		if (t === "① or more cost for one of your Units' effects, you may increase this Unit's AP during this turn by an amount equal to the cost paid.") {
			if (!ctx.active_text || ctx.active_cost < 1 || !ctx.active_unit.isUnit() || ctx.active_unit.owner !== p) return false
			eotAP(u, ctx.active_cost)
			return true
		}
		if (t === "① or more for one of your Unit's effects, if this is a (Militia) Unit, it may recover 2 HP.") {
			if (!ctx.active_text || ctx.active_cost < 1 || !ctx.active_unit.isUnit() || ctx.active_unit.owner !== p || !u.hasTrait("Militia")) return false
			await u.recover(2)
			return true
		}
	}

	log(`🚩🚩FIXME: Not implemented ${card.type} ${card.id} "${act}${clause}": "${t}". p battle length: ${p.battle.length}`, true, true, true)
	return false
}

let games = ngames.value
let game = 0
let game_start = new Date()
window.game_over = false
window.stop = false
let turn = 0
let p1 = null
let p2 = null

/** AI tries to keep/kill higher value cards */
function valUnit(u) {
	// It appears that considering Breach|First Strike|High-Maneuver|Repair|Support|Suppression
	// +[Attack] -[Destroyed] backfires.
	// let t = u.text + (u.pilot ? u.pilot.text : "")
	return 2 * u.AP() + u.HP()
}

async function playGame() {
	// prevent lag and make game start easier to find
	// FIXMEs stay in the browser console
	dlog.innerHTML = ''
	if (game > 0) showStats()
	game += 1
	game_start = new Date()
	log(`\n<br>🏁Game ${game}/${games} start: ${game_start.toISOString().replace('T', ' ')}`, false)
	setGameOver(false)
	pid = 0
	cid = 0
	p1 = new Player("Player 1")
	p2 = new Player("Player 2")
	let p = rndPick([p1, p2])
	active_player = p
	let enemy = p === p1 ? p2 : p1
	enemy.resource.push(enemy.getCard(rndPick(EX_RESOURCES)))
	await render()
	turn = 0
	while (true) {
		turn += 1
		active_player = p
		let yes = false
		// Start phase
		// Active Step
		if (p.base !== null) await activate(p.base)
		for (const c of p.resource) {
			if (c.rested) await activate(c)
		}
		for (const c of p.battle) {
			if (c.rested) await activate(c)
			c.sick = false
		}
		await sleep(1000)
		log("")
		// Start Step
		// Effects that specify “at the start of the turn” activate.
		// None of those exist yet.
		//for (const c of p1.battle.concat(p2.battle)) {
		// await run(c, "During Pair")
		// await run(c, "During Link")
		//}

		// Draw phase
		try {
			await p.draw(1, false)
			await render()
		} catch (ex) {
			log("🚩" + ex)
			break
		}
		// Resource phase
		let r = p.resource_deck.pop()
		if (r) {
			p.resource.push(r)
			await render()
			await sleep(1500)
		}
		let ai = (p === p1 ? p1ai.checked : p2ai.checked)
		let level = p.resource.length
		log("📈Turn " + turn + " " + p.name + " level " + level)
		// Main phase
		let considered = []
		while (!window.stop) {
			let ctx = {}
			level = p.resource.length
			let res = p.resource.filter(c => !c.rested).length || 0

			let to_play = mySort(p.hand.filter(c => !considered.includes(c)), c => ["BASE", "UNIT", "PILOT", "COMMAND"].indexOf(c.type) * 10 + c.COST())
			if (to_play.length < 1) break
			let c = to_play[0]
			if (!ai) {
				c = await chooseCard(p.hand.filter(c => c.LEVEL() <= level && c.COST() <= res))
				if (!c) break
			}
			considered.push(c)

			// if (!p.canUse(c)) continue // only goes for link
			let clevel = c.LEVEL()
			let cost = c.COST()
			if (inStr(c.text, "When playing this card from your hand, you may destroy 1 of your Link Units with \"Unicorn Mode\" in its card name that is Lv.5. If you do, play this card as if it has 0 Lv. and cost.")) {
				let target = p.battle.filter(c2 => inStr(c2.name, "Unicorn Mode") && c2.linked() && c.LEVEL() === 5)[0]
				if (target && (ai || confirm(`Destroy ${target} to play ${c} for 0?`))) {
					ctx = {...ctx, destroyer: card}
					await destroy(target, ctx)
					clevel = 0
					cost = 0
				}
			}
			if (inStr(c.text, "When playing this card from your hand, you may discard 1 (G Generation) Unit card. If you do, play this card as if it has 2 Lv. and cost.")) {
				let target = p.hand.filter(c2 => c2 !== c && c2.type === "UNIT" && c.hasTrait("G Generation"))[0]
				if (target && (ai || confirm(`Discard ${target} to play ${c} for 2?`))) {
					await p.discard(ctx, 1, [target])
					clevel = 2
					cost = 2
				}
			}
			let pairwith = null
			if (inStr(c.text, "When playing this card from your hand and pairing it with a Unit with \"Gundam NT-1\" in its card name, play this card as if it has 0 cost.")) {
				let target = p.battle.filter(c2 => inStr(c2.name, "Gundam NT-1") && !c2.pilot)[0]
				clevel = 0
				cost = 0
				pairwith = target
			}
			if (clevel > level || cost > level) continue
			if (ai) {
				// already have a base
				if (c.type === "BASE" && p.base !== null) continue
				// max 6 units
				if (c.type === "UNIT" && p.battle.length >= 6) continue
			}
			let empty_units = p.getPairableUnits()
			let doPair = !!pairwith
			if (empty_units.length < 1 && c.type === "PILOT") continue
			if (!doPair && empty_units.length > 0 && (c.type === "PILOT" || inStr(c.text, "[Pilot]"))) {
				doPair = true
				empty_units.sort(u => !linksWith(u, c))
				if ((!linksWith(empty_units[0], c) && p.hand.filter(c => linksWith(empty_units[0], c)).length > 0)) {
					if (c.type === "PILOT") continue
					doPair = false
				}
			}
			// log(`🤔Considering ${c.type} #${c.cid} ${c.id} ${c.name}`)
			// ensure cards have HTML elements
			await render()
			if (!ai) {
				if (doPair && c.type === "COMMAND") doPair = confirm(`Pair ${c}?`)
			}
			if (await p.pay(cost, c, false)) {
				// Remove card from hand
				p.hand = p.hand.filter(item => item !== c)
				await sleep(300)
				if (c.type === "COMMAND") {
					// Do pilot part of command 2/3 of the time.
					if ((!doPair || !inStr(c.text, "[Pilot]") || rnd(1, 3) > 2) && await run(c)) {
						// Command
						trash(c)
						await render()
						await p.paid(cost, c)  // TODO: Paid before activate events?
						await sleep(800)
						await publish("play and activate", p.battle, {active_card: c})
						continue
					} else {
						// [Pilot]
						if (doPair) {
							let unit = pairwith || empty_units[0]
							if (!ai) unit = await chooseCard(empty_units)
							await pair(unit, c)
							await render()
							await p.paid(cost, c)
							continue
						}
						// No useful target, so don't play this and roll back / refund payment.
						if (cost > 0) {
							let r = null
							while (r = spent.pop()) {
								r.rested = false
								p.resource.push(r)
								--cost
							}
							await render()
							for (let i = 0; i < cost; ++i) {
								await activate(p.resource[i])
							}
						}
						spent = []
						p.hand.push(c)
						continue
					}
				}
				if (c.type === "BASE" || c.type === "UNIT") {
					await p.deploy(ctx, c)
				} else if (c.type === "PILOT") {
					let unit = pairwith || empty_units[0]
					if (!ai) unit = await chooseCard(empty_units)
					await pair(unit, c)
				}
				await p.paid(cost, c)
				await sleep(800)
			}
		}
		yes = p.base && inStr(p.base.text, "Activate･Main") && (ai || await chooseCard([p.base]))
		if (yes) await run(p.base, "Activate･Main")
		for (const c of p.battle) {
			yes = inStr(c.text + (c.pilot ? c.pilot.text : ""), "Activate･Main") && (ai || await chooseCard([c]))
			if (yes) await run(c, "Activate･Main")
		}

		// Attack Step
		considered = []
		while (true) {
			const can_attack = p.usefulAttackers().filter(c => !considered.includes(c))
			if (can_attack.length < 1) break
			const att = can_attack[0]
			considered.push(att)
			if (ai && att.AP() < 1) continue

			enemy = p === p1 ? p2 : p1
			// Battle Area
			let prone = enemy.getProne(att)

			// Base and shields also count as enemy player: https://www.gundam-gcg.com/en/cards/index.php?freeword=GD04-016#cards
			let must_attack_unit = inStr(att.text, "This Unit can't choose the enemy player as its attack target") || att.hasKw("must_attack_unit")

			// TODO: Action can solve this in doBattle
			if (att.level <= 4 && enemy.kw_eot.some(txt => txt.match(new RegExp(`noDmgShield enemy.unit.lv[${att.level}-9]`)))) {
				must_attack_unit = true
			}
			if (enemy.base && !att.canDamage(enemy.base)) {
				must_attack_unit = true
			}

			if (prone.length > 0) {
				let def = null
				let targets = []
				for (let u of enemy.battle) {
					if (u.hasKw("must be attack target")) targets.push(u)
					else if (u.pilot && inStr(u.pilot.text, "[During Link]Enemy Units other than Link Units choose this rested Unit as their attack target if possible when attacking.") && u.rested && u.linked()) targets.push(u)
					else if (u.pilot && u.rested && inStr(u.text, "[During Pair]Enemy Units choose this rested Unit as their attack target if possible when attacking.")) targets.push(u)
					else if (u.pilot && u.rested && u.text === "[During Pair]While you have another (Superpower Bloc) Unit in play, enemy Units choose this rested Unit as their attack target if possible when attacking." && u.owner.battle.some(c => c !== u && c.hasTrait("Superpower Bloc"))) targets.push(u)
					else if (u.text === "Enemy Units choose one of your rested (Maganac Corps) Units as their attack target if possible when attacking.") {
						targets = targets.concat(enemy.battle.filter(c => c.rested && c.hasTrait("Maganac Corps")))
					}
				}

				if (targets.length > 0) {
					must_attack_unit = true
					prone = targets
				}
				def = prone.filter(bc => att.canDamage(bc))[0]
				if (def) {
					// Attack unit if enemy has more defense (TODO: count active blockers?)
					let attack_unit = p.shield.length + !!p.base < enemy.shield.length + !!enemy.base
					const aap = att.AP()
					const dap = def.AP()
					const ahp = att.HP() + att.hp_eob + att.hp_eot
					const dhp = def.HP() + def.hp_eob + def.hp_eot
					const afs = att.hasKw("First Strike")
					const dfs = def.hasKw("First Strike")
					// TODO: consider effect damage & (de)buffs
					let we_die = ahp <= dap || def.text === "When this Unit deals battle damage to an enemy Unit, destroy that enemy Unit."
					let they_die = dhp <= aap || att.text === "When this Unit deals battle damage to an enemy Unit, destroy that enemy Unit."
					if (afs && !dfs && they_die) we_die = false
					if (dfs && !afs && we_die) they_die = false

					// Free kill helps a little, even with Suppression: 5012 vs 4987. TODO: Limit to breach?
					const free_kill = they_die && !we_die
					if (free_kill) attack_unit |= free_kill
					else if (they_die) {
						let good_trade = valUnit(def) > valUnit(att)
						// Prefer to hit shields instead of dying with these keywords
						let kws = ["Breach", "High-Maneuver", "Suppression"]
						// Blocker|First Strike|Repair|Support make no difference or should trade
						for (const kw of kws) good_trade = good_trade && !att.hasKw(kw)
						if (good_trade) {
							// log(`FIXME: trading ${att} for ${def}`)
							attack_unit |= good_trade
						}
					}

					// Don't attack unit if enemy is open.
					if (!must_attack_unit && enemy.shield.length + !!enemy.base < 1) attack_unit = false

					if (attack_unit) {
						yes = ai || await chooseCard([def])
						if (yes) await attackStep(att, def)
						continue
					}
				}
			}
			if (must_attack_unit) {
				continue
			}

			// Shield Area
			if (att.level <= 4 && enemy.kw_eot.some(txt => txt.match(new RegExp(`noDmgShield enemy.unit.lv[${att.level}-9]`)))) {
				log("🛡️Shield area damage prevented.")
				continue
			}
			if (enemy.base) {
				// XXX: Peaceful Timbre is an action so would be ran during battle.
				if (!att.canDamage(enemy.base)) {
					log(`🛡️${enemy.base} would take no battle damage from ${att}`)
					continue
				}
				yes = ai || await chooseCard([enemy.base])
				if (yes) await attackStep(att, enemy.base)
			} else {
				if (enemy.shield.length > 0 && enemy.shield.slice(-1)[0].hasKw("protection.enemy.units")) {
					log("🛡️" + enemy.name + " shield protected from enemy units")
					continue
				}
				yes = ai || await chooseCard([att])
				if (yes) await attackStep(att)
			}

			// Battle End
			for (const c of p1.battle.concat(p2.battle)) {
				c.ap_eob = 0
				c.hp_eob = 0
				c.kw_eob = []
			}
			for (const c of p1.trash.concat(p2.trash).concat(p1.hand).concat(p2.hand)) {
				c.ap_eob = 0
				c.hp_eob = 0
				c.kw_eob = []
			}
			p.kw_eob = []
			await render()
			if (window.game_over) break
		}
		if (window.game_over) break

		// End Phase
		// Step 1 Action
		await actionStep()
		// Step 2 Resolve effects
		for (const c of p1.battle.concat(p2.battle)) {
			await run(c, "", "At the end of the turn ")
			if (active_player === c.owner) await run(c, "", "At the end of your turn, ")
			if (c.damage > 0) {
				const repair = c.getRepair()
				if (repair) {
					log(`🛠️Repair ${repair} ${c}`)
					c.damage -= repair
					if (c.damage < 0) c.damage = 0
				}
			}
		}
		// Step 3 Discard to 10
		while (p.hand.length > 10) await p.discard({})
		// Step 4 Reset temporary effects
		for (const c of p1.battle.concat(p2.battle).concat(p1.trash).concat(p2.trash).concat(p1.hand).concat(p2.hand)) {
			c.ap_eot = 0
			c.hp_eot = 0
			c.kw_eot = []
		}
		p.kw_eot = []
		once_per_turn = []

		// Pass turn
		// wait for untap animation
		await sleep(400)
		await render()
		// log(structuredClone(p))  // clone to keep current lists state
		p = p === p1 ? p2 : p1
	}
	setGameOver(true)
}

function setGameOver(b) {
	window.game_over = b
	bstart.disabled = !window.game_over
	bstop.disabled = window.game_over
	// bhone.disabled = !window.game_over
}

let deck_stats = {}
let deck_winturns = {}
let player_wins = [0, 0]
/** End game and update stats. */
function endGame(winner) {
	setGameOver(true)
	if (winner) {
		let loser = (winner === p1 ? p2 : p1)
		player_wins[winner === p1 ? 0 : 1] += 1

		let wdl = deck_stats[winner.deckname] || [0, 0, 0]
		wdl[0] += 1
		deck_stats[winner.deckname] = wdl

		if (deck_winturns[winner.deckname]) {
			deck_winturns[winner.deckname] = deck_winturns[winner.deckname].slice(-9)
			deck_winturns[winner.deckname].push(turn)
		} else deck_winturns[winner.deckname] = [turn]

		wdl = deck_stats[loser.deckname] || [0, 0, 0]
		wdl[2] += 1
		deck_stats[loser.deckname] = wdl
	} else {
		for (const p of [p1, p2]) {
			let wdl = deck_stats[p1.deckname] || [0, 0, 0]
			wdl[1] += 1
			deck_stats[p1.deckname] = wdl
		}
	}
	log(`🏁Game ${game}/${games} end: ${new Date().toISOString().replace('T', ' ')} in ${Math.round((new Date() - game_start) / 1000)}s`)
}

/** Sort function for win stats */
function sortWDL(a, b) {
	let winrate_a = a[0] / (a[0] + a[1] + a[2])
	let winrate_b = b[0] / (b[0] + b[1] + b[2])
	if (winrate_a > winrate_b) return -1
	if (winrate_a < winrate_b) return 1
	// W
	if (a[0] > b[0]) return -1
	if (a[0] < b[0]) return 1
	// D
	if (a[1] > b[1]) return -1
	if (a[1] < b[1]) return 1
	// L
	if (a[2] > b[2]) return 1
	if (a[2] < b[2]) return -1
	return 0
}

function sortStats(a, b) {
	return sortWDL(a[1], b[1])
}

function showStats() {
	// For CLI: let m = Number((new Date() - games_start) / 60000); JSON.stringify(Object.entries(deck_stats).sort(sortStats)) + " / " + game + " / " + m.toFixed(2) + " = " + (m/game*60).toFixed(3) + "s/game; " + ((games-game) * m/game).toFixed(2) + "m left"
	delay = 1
	const m = Number((new Date() - games_start) / 60000)
	let msg = `Game ${game}/${games} over in ${m.toFixed(2)}m; ${(m / game * 60000).toFixed(0) + "ms/game"}`
	if (game < games) msg += "; ETA " + ((games - game) * m / game).toFixed(2) + "m"

	let win_perc = (player_wins[1]) / (player_wins[0] + 0.000001) * 100
	msg += `<br>\n${p1.name}: ${player_wins[0]}; ${p2.name}: ${player_wins[1]} ${win_perc.toFixed(0)}%<br>\nDecks ranked by W% W/D/L avg win turn:`
	const stats = Object.entries(deck_stats).sort(sortStats)
	for (let i = 0; i < stats.length; ++i) {
		const [name, s] = stats[i]
		msg += `<br>\n${1 + i}. <a href="#" onclick='showDeck(\"${escapeHTML(name)}\"); event.preventDefault()'>${name}</a>: ${(s[0] / (s[0] + s[1] + s[2]) * 100).toFixed(0)}% ${s}${!deck_winturns[name] ? "" : " " + Math.ceil(deck_winturns[name].reduce((tot, a) => tot + a, 0) / (deck_winturns[name].length) / 2)}`
	}
	log(msg, false)
	setSpeed()
}

async function playGames() {
	if (Object.keys(CARDS).length < 1) await loadCards()
	games = parseInt(ngames.value)
	game = 0
	deck_stats = {}
	deck_winturns = {}
	player_wins = [0, 0]
	setVolume()
	window.games_start = new Date()
	while (!window.stop && game < games) {
		setSpeed()
		try {
			await playGame()
		} catch (ex) {
			if (!inStr("" + ex, "💀")) {
				log(`🚩🚩FIXME: PG: ${ex} ${ex.stack}`, true, true, true)
				throw Error(ex)
			}
		}
		if (game > 1 && delay > 0 || game >= games) showStats()
		if (delay > 0) {
			delay = 1
			await render()
			if (games <= 10) await sleep(3000)
			else await sleep(100)
			setSpeed()
		}
	}
	for (const card of Object.keys(CARDS)) {
		if (card.covered_lines) {
			let covered = Object.keys(card.covered_lines).length
			let expected = card.text.split("\n")
			if (covered !== expected) {
				log(`🚩🚩FIXME cov: ${card.id} only covered ${covered}/${expected}: ${Object.keys(card.covered_lines)}`, true, true, true)
			}
		}
	}
}

function toggleSearch() {
	if (search.classList.contains('searchsmall')) {
		search.classList.remove('searchsmall')
		searchtext.focus()
	}
	else search.classList.add('searchsmall')
}
function toggleSettings() {
	if (settings.classList.contains("open")) settings.classList.remove("open")
	else settings.classList.add("open")
}

function findCards(query) {
	let html = ""
	let oldcid = cid
	let count = 0
	let results = []
	let tosearch = Object.entries(CARDS)
	let op = "AND"
	for (let q of query.split(/ (AND|OR) /)) {
		if (q === "AND") {
			if (count === 0) break
			op = "AND"
			tosearch = results
			continue
		}
		if (q === "OR") {
			op = "OR"
			continue
		}
		count = 0
		if (op === "AND") results = []
		const invert = q.indexOf("NOT ") === 0
		q = q.toLowerCase()
		for (const entry of tosearch.toSorted()) {
			const text = JSON.stringify(entry[1]).replaceAll(/(?<!\\)"/g, '').replaceAll('\\"', '"').toLowerCase()
			let add = false
			if ((invert ? !inStr(text, q.slice(4)) : inStr(text, q))
				|| (invert ? !inStr(text, q.slice(4).replaceAll('"', '')) : inStr(text, q.replaceAll('"', '')))) {
				if (results.includes(entry)) continue
				results.push(entry)
				++count
			}
		}
	}
	if (results.length < 1) html = "No results."
	else {
		count = 0
		cid = oldcid
		html = `${results.length} results: <input type="text" value="${results.map(o => o[0])}"/><br>`
		for (const entry of results) {
			let left = 5 + (count % 10) * 11
			let top = 10 + Math.floor(count / 10) * 15
			++count
			html += p1.getCard(entry[0]).toHTML(left, top, "", 0, true)
		}
	}
	searchresults.innerHTML = html
	return results
}

playGames()

window.clamp = clamp
window.compareDecks = compareDecks
window.findCards = findCards
window.honeDeck = honeDeck
window.log = log
window.playGames = playGames
window.setGameOver = setGameOver
window.setSpeed = setSpeed
window.setVolume = setVolume
window.showDeck = showDeck
window.toggleSettings = toggleSettings
window.toggleSearch = toggleSearch
window.zoom = zoom