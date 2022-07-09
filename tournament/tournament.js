'use strict'

// Prevent accidental reload on swipe up.
onbeforeunload = () => false

let match_nr = 0
let names = []
let played = {}
let points_per_win = 3
let points_per_draw = 1
let points_per_loss = 0

const BYE = 'bye'
const float = (s) => parseFloat(s) || 0.0
const int = (s) => parseInt(s) || 0
const el = (id) => document.getElementById(id)
const sel = (q, e=document) => e.querySelectorAll(q)

const saying = new Set()
function say(s, rate=1.0, pitch=1.0, lang='en-US'){
	// rate: [0.1, 10], pitch: [0, 2], lang: BCP 47 language tag
	const u = new SpeechSynthesisUtterance(s)
	u.lang = lang
	u.pitch = pitch
	u.rate = rate
	saying.add(u)
	u.onend = e => {
		saying.delete(e.utterance)
		if(saying.size < 1) [...document.getElementsByClassName('say')].forEach(e => e.disabled = false)
	}
	speechSynthesis.speak(u)
	// In case Windows speech server starts leaving out first part again every 10 seconds.
	//speechSynthesis.speak('uh'); setTimeout(()=>speechSynthesis.speak(u), 900)
}

function egg(s){
	const a = [...Array(13)].map(_ => '0123456789abcdef'[Math.floor(Math.random() * 16)])
	a[6] = '&#'
	location.hash = s? s : '##' + a.join('')
}

function set_colors(){
	const bs = getComputedStyle(document.body)
	let [bg, fg] = location.hash.slice(1).split('&')
	bg = bg || bs.backgroundColor
	fg = fg || bs.color
	document.body.style.backgroundColor = bg
	document.body.style.color = fg
	;[...sel('.alert')].forEach(e => e.style.backgroundColor = bg)
	;[...sel('hr, input, table, .alert')].forEach(e => e.style.borderColor = fg)
}

function make_node(html){
	const div = document.createElement('div')
	div.innerHTML = html.trim()
	return div.firstChild
}

function add_node(html){
	el('content').appendChild(make_node(html))  // Adding to innerHTML clears inputs.
}

function rank_players(){
	const scores = {}
	const wins = {}
	const draws = {}
	const losses = {}
	const resistance = {}
	const neustadtl_scores = {}

	for(const name of names){
		for(const d of [scores, resistance, neustadtl_scores]) d[name] = 0
		for(const d of [wins, draws, losses]) d[name] = []
		if(!(name in played)) played[name] = new Set()
	}

	const rows = [...sel('.match tr')].filter(e => e.querySelector('td'))
	for(const row of rows){
		for(let player=0; player < 2; ++player){
			const name = sel('td', row)[1 + player].innerText
			const opponent = sel('td', row)[1 + (1-player)].innerText
			let [p1, p2] = [...sel('.score', row)].map(e => int(e.innerText))
			if(player == 1) [p1, p2] = [p2, p1]
			if(p1 !== undefined && p2 !== undefined){
				if(p1 > p2){
					wins[name].push(opponent)
					scores[name] += points_per_win
				}else if (p1 == p2){
					draws[name].push(opponent)
					scores[name] += points_per_draw
				}else{
					losses[name].push(opponent)
					scores[name] += points_per_loss
				}
			}
		}
	}

	for(const name of names){
		for(const opponent of wins[name]) neustadtl_scores[name] += scores[opponent]
		for(const opponent of draws[name]) neustadtl_scores[name] += 0.5 * scores[opponent]
		for(const opponent of played[name]) resistance[name] += scores[opponent]
	}
	const ranking = names.map((key, index) => {
			return [-scores[key], -wins[key].length, -draws[key].length, losses[key].length, -neustadtl_scores[key], -resistance[key], index, key]  // If tied, index keeps status quo.
		}
	)
	ranking.sort((a, b) => {
		if(a.slice(-1) == BYE) return 1
		if(b.slice(-1) == BYE) return -1
		for(const i in a){
			if(a[i] == b[i]) continue
			return a[i] - b[i]
		}
	})
	names = ranking.map(a => a[a.length-1])
	let html = `<table><th>Rank</th><th>Player</th><th>Score</th>
	<th>Won <span contentEditable onblur='points_per_win = float(this.innerText); rank_players()'>${points_per_win}</span>pt</th>
	<th>Drawn <span contentEditable onblur='points_per_draw = float(this.innerText); rank_players()'>${points_per_draw}</span>pt</th>
	<th>Lost <span contentEditable onblur='points_per_loss = float(this.innerText); rank_players()'>${points_per_loss}</span>pt</th>
	<th>Neustadtl score</th><th title="Sum of Opponents' Scores">SOS</th></tr>`
	let rank = 0
	let prev = []
	for(let i in ranking){
		let a = ranking[i]
		let name = a[a.length-1]
		if(name == BYE) continue
		if(a.slice(0, a.length-2) !=''+ prev.slice(0, a.length-2)) ++rank
		html += `<tr><td>${rank}</td><td>${name}</td><td>${-a[0]}</td><td>${-a[1]}</td><td>${-a[2]}</td><td>${a[3]}</td><td>${-a[4]}</td><td>${-a[5]}</td></tr>`
		prev = a
	}
	html += `</table><br><input type='button' onclick='this.disabled = true; tell_pairs()' class='say' value='Announce pairings'>`
	el('names').innerHTML = html
	set_colors()
	sortable_tables()
}

function sortable_tables(){
	// Based on https://stackoverflow.com/a/49041392/819417
	function sort_column(e){
		let th = e.target
		if(th.className === 'arrow') th = th.parentNode 
		if(th.tagName !== 'TH') return
		const table = th.closest('table')
		const getCellValue = (tr, idx) => (
			tr.children[idx].innerText ||
			tr.children[idx].textContent
		)
		const comparer = (idx, asc) => (a, b) => (
			(v1, v2) => v1 !== '' && v2 !== '' && !isNaN(v1) && !isNaN(v2) ? v1 - v2 : v1.toString().localeCompare(v2)
		)(getCellValue(asc ? a : b, idx), getCellValue(asc ? b : a, idx))
		Array.from(table.querySelectorAll('tr:nth-child(n+2)'))
			.sort(comparer(Array.from(th.parentNode.children).indexOf(th), th.asc = !th.asc))
			.forEach(tr => table.appendChild(tr))
		const up = '\u2191'
		const down = '\u2193'
		for(const h of th.parentNode.children){
			let a = sel('.arrow', h)
			if(!a.length){
				const span = document.createElement('span')
				span.className = 'arrow'
				h.appendChild(span)
			}
			sel('.arrow', h)[0].innerText = (h !== th? '' : th.asc? up : down)
		}
	}
	sel('th').forEach(th => th.onclick = sort_column)
}

const shuffled = (arr) => arr.map(e => [Math.random(), e]).sort().map(a => a[1])

function shuffle_players(){
	const ul = document.querySelector('ol')
	for(let i = ul.children.length; i >= 0; --i){
		ul.appendChild(ul.children[Math.random() * i | 0])
	}
}

function nonblocking_alert(msg){
	const ac = el('alertcontainer')
	if (getComputedStyle(ac).visibility == 'hidden'){
		ac.innerText = ''
		ac.style.visibility = 'visible'
	}
	const d = document.createElement('div')
	d.className = 'alert'
	d.innerHTML = msg
	el('alertcontainer').appendChild(d)
	set_colors()
}

function pair_players(){
	if(match_nr && [...sel('.match .score')].slice(-names.length).map(e => e.innerText).filter(s => s.trim() != '').length !== names.length - names.includes(BYE)? 1 : 0){
		nonblocking_alert('Last match results incomplete.')
		return
	}
	stop_timer()

	if(match_nr == 0){
		names = [...sel('li')].map(e => e.innerText).filter(s => s.trim() != '')
		if(names.length % 2) names.push(BYE)
		rank_players()
	}else{
		const opponent_sets = Object.values(played)
		if(opponent_sets.length && opponent_sets[0].size > names.length-2){
			if(confirm('All pairs have played. Still add a new round?')){
				played = {}
			}else{
				rank_players()
				return
			}
		}
		rank_players()
		let boost = 0
		while(1){
			var new_names = []
			for(var i=0; i < names.length; ++i){
				let player = names[i]
				if(new_names.includes(player)) continue
				new_names.push(player)
				let opponent = names.find(name => name != player && !played[player].has(name) && !new_names.includes(name))
				if(!opponent){
					++boost
					names[i] = names[i-boost]
					names[i-boost] = player
					break
				}
				new_names.push(opponent)
			}
			if(i == names.length) break
		}
		names = new_names
	}

	++match_nr
	let html = `<table class='match' onkeyup='rank_players()'><tr><th>Table</th><th>P1</th><th>P2</th><th>P1 games</th><th>P2 games</th></tr>`
	for(let i=0; i < names.length / 2; ++i){
		const p1 = names[i*2]
		const p2 = names[i*2+1]
		if(p1 in played){ played[p1].add(p2) }else{ played[p1] = new Set([p2]) }
		if(p2 in played){ played[p2].add(p1) }else{ played[p2] = new Set([p1]) }
		html += `<tr><td>${i+1}</td><td>${p1}</td><td>${p2}</td><td class='score' contentEditable></td><td class='score' ${p2 == BYE ? '' : 'contentEditable'}></td></tr>`
	}
	html += '</table>'
	add_node(html)
	set_colors()
	sortable_tables()
}

function tell_pairs(check){
	[...sel('.match')].pop().querySelectorAll('tr').forEach(e=>{
		const td = sel('td', e)
		if(!td.length) return  // Don't read table header.
		say('Table ' + td[0].innerText + ': ' + td[1].innerText + ' versus ' + td[2].innerText)
	})
}

var timer = null
function toggle_timer(){
	if(timer === null) start_timer()
	else stop_timer()
}
function start_timer(){
	timer = setInterval(tick, 1000)
	el('btn_timer').value = 'Stop timer'
	el('woke').play()
	const end_date = new Date()
	const [m, s] = el('duration').value.split(':').map(e => int(e))
	end_date.setSeconds(end_date.getSeconds() + s + 60*m)
	const match_info = `Match ${match_nr} ends at ${end_date.toTimeString().slice(0, 5)}.`
	say(match_info, 0.9)
	add_node(`<h3>${match_info} <span class='timer'>Time left: <span class='time'>${el('duration').value}</span></h3>`)
}
function stop_timer(){
	clearInterval(timer)
	timer = null
	el('btn_timer').value = 'Start timer'
}
function tick(){
	let timer = sel('.timer')
	if(timer.length < 1) return
	timer = timer[timer.length-1]
	const t = sel('.time', timer)[0]
	let [m, s] = t.innerText.split(':')
	if(s){
		if(s > 0) s = int(s) - 1
		else if(m > 0){
			s = 59
			m = int(m) - 1
		}
	}
	const time = ('0'+m).slice(-2) + ':' + ('0'+s).slice(-2)
	t.innerText = document.title = time
	let bc = timer.style.backgroundColor
	let c = timer.style.color
	s = ''
	if(time == '00:00' && c != 'red'){
		bc = 'red'
		c = 'black'
		s = 'Time. Active player finishes turn and opponent gets one last turn.'
		stop_timer()
	}else if(time == '05:00'){
		bc = 'orange'
		c = 'black'
		s = '5 minutes.'
	}else if(time == '10:00'){
		bc = 'yellow'
		c = 'black'
		s = '10 minutes.'
	}
	timer.style.backgroundColor = bc
	timer.style.color = c
	if(s) say(s)
}

function init(){
	set_colors()
	el('date').innerHTML = new Date()
}