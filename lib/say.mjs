import sleep from './sleep.mjs'

const saying = new Set()
function say(s, rate=1.0, pitch=1.0, lang="en-US", volume=1.0){
	// rate: (0.1,10), pitch: (0,2), lang: BCP 47 language tag
	// So 0.1 < rate < 10, see https://en.wikipedia.org/wiki/Interval_(mathematics)
	const u = new SpeechSynthesisUtterance(s)
	u.lang = lang
	u.pitch = pitch
	u.rate = rate
	u.volume = volume
	saying.add(u)
	u.onend = e => {
		saying.delete(e.utterance)
		if(saying.size < 1) [...document.getElementsByClassName("say")].forEach(e => e.disabled = false)
	}
	speechSynthesis.speak(u)
}

export default async function wake_n_say(s, rate=1.0, pitch=1.0, lang="en-US", volume=1.0){
	say('a', 9, 1, "en-US", 0)  // Wake sleeping audio jack.
	await sleep(1500).then(()=>say(s, rate, pitch, lang, volume))
}