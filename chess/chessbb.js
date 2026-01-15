"use strict"
import sleep from '/lib/sleep.js'
import say_it from '/lib/say.js'

onbeforeunload = () => false

const SAFARI = navigator.userAgent.indexOf('Safari') > -1
const WINDOWS = navigator.userAgent.indexOf('Windows') > -1
const COLORS = navigator.userAgent.indexOf('Chrome') > -1
const MONOSPACE = !WINDOWS

const WHITE = 0
const BLACK = 1
const FULL64 = 0b11111111_11111111_11111111_11111111_11111111_11111111_11111111_11111111n
const EMPTY = 0
const PAWN = 1
const ROOK = 2
const KNIGHT = 3
const BISHOP = 4
const QUEEN = 5
const KING = 6
window.EMPTY = EMPTY   // TODO: Replace with color?
window.PAWN = PAWN
window.ROOK = ROOK
window.KNIGHT = KNIGHT
window.BISHOP = BISHOP
window.QUEEN = QUEEN
window.KING = KING
const NAMES = ['Empty', 'Pawn', 'Rook', 'Knight', 'Bishop', 'Queen', 'King']
const CHARS = [' ', '', 'R', 'N', 'B', 'Q', 'K']
const VALUES = [0.0, 1.0, 5.63, 3.05, 3.33, 9.5, 10.0]  // Fractions by AlphaZero. King is officially 0; playwise 3.5 to 4.

function clog(msg) {
	console.log("%c" + msg, "font-family: monospace; color: black; background-color: white")
}

class Board {
	constructor(depth) {
		this.reset()
		this.depth = depth || 0
	}

	get_moves(pos, depth = 0) {
		console.log(depth)
		if (depth > 3) return []  // XXX
		const moves = []
		let dirs = []
		const board = this
		const grid = this.grid
		const log = this.log
		const color = this.i2color(pos) //(this.colors & (1n << BigInt(pos))) ? BLACK : WHITE
		const x = pos % 8
		const y = Math.floor(pos / 8)
		switch (grid[pos]) {
			case PAWN:
				// Move straight.
				dirs = color ? [[0, 1]] : [[0, -1]]
				for (const dir of dirs) {
					const tx = x + dir[0]
					const ty = y + dir[1]
					const piece = board.xy2p(tx, ty)
					if (piece === EMPTY) {
						moves.push(xy2i(tx, ty))
						if (color && y === 1 && grid[(ty + 1) * 8 + tx] === EMPTY) moves.push(xy2i(tx, ty + 1))
						if (!color && y === 6 && grid[(ty - 1) * 8 + tx] === EMPTY) moves.push(xy2i(tx, ty - 1))
					}
				}
				// Capture diagonally.
				dirs = color ? [[-1, 1], [1, 1]] : [[-1, -1], [1, -1]]
				for (const dir of dirs) {
					const tx = x + dir[0]
					const ty = y + dir[1]
					const piece = board.xy2p(tx, ty)
					if (piece > EMPTY && this.xy2color(tx, ty) !== color) {
						moves.push(xy2i(tx, ty))
					}
					// En passant.
					if ((color === BLACK && y === 4)
						|| (color === WHITE && y === 3)) {
						const double_jump = xy2fr(tx, color ? 6 : 1) + xy2fr(tx, color ? 4 : 3)
						if (log.slice(-1)[0] === double_jump) {
							moves.push(xy2i(tx, ty))
						}
					}
				}
				return moves
			case ROOK:
				dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
				break
			case KNIGHT:
				for (const dir of [[-2, -1], [-2, 1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2]]) {
					const tx = x + dir[0]
					const ty = y + dir[1]
					const piece = this.xy2p(tx, ty)
					if (piece === EMPTY || piece && this.xy2color(tx, ty) !== color) {
						moves.push(xy2i(tx, ty))
					}
				}
				return moves
			case BISHOP:
				dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
				break
			case QUEEN:
				dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [-1, 0], [0, 1], [0, -1]]
				break
			case KING:
				if (!depth) depth = 0
				for (const dir of [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const tx = x + dir[0]
					const ty = y + dir[1]
					const piece = board.xy2p(tx, ty)
					if (piece === EMPTY || piece && this.xy2color(tx, ty) !== color) {
						moves.push(xy2i(tx, ty))
					}
				}
				if (depth > 0) return moves // Depth 1 needed to cover piece for checkmate on 8/8/8/6N1/P3B3/2K5/8/kQ6 w - - 10 48
				// Castling.
				/* https://chessily.com/learn-chess/king/
				The king and rook have not yet been moved in the game.
				The king is not in check before and immediately after castling.
				The king will not move through a check during castling.
				All squares between the rook and king are empty.
				Castle to checkmate by Paul Morphy vs. Alonzo Morphy, 1-0 Rook odds New Orleans 1858:
				r4b1r/ppp3pp/8/4p3/2Pq4/3P4/PP2QPPP/2k1K2R w K - 0 19
				*/
				const moved = this.i2moved(pos)
				if (!moved && this.is_safe(pos, depth + 1)) {
					// Queenside
					let i = color ? 0 : 56
					const rank = color ? 8 : 1
					if (grid[i] === ROOK && !this.i2moved(i)) {
						let clear = true
						for (let j = i; j < pos; ++j) {
							if (grid[j] !== EMPTY) clear = false
						}
						if (clear) moves.push(8 * (8 - rank) + 2)
					}
					// Kingside
					i = color ? 7 : 63
					if (grid[i] === ROOK && !this.i2moved(i)) {
						let clear = true
						for (let j = i; j > pos; --j) {
							if (grid[j] !== EMPTY) clear = false
						}
						if (clear) moves.push(6 + 8 * (8 - rank))
					}
				}
				// Remove unsafe moves.
				let safe_moves = []
				for (const i of moves) {
					if (grid[i] === KING) {
						// Happens in deep thought.
						//const foo = [...board.log]; let i = 1; let j = 0; let s = ''; while (foo.length > 0) { s += `${j}. ${foo.shift() + ' ' + foo.shift()} `; i += 2; j += 1 }; clog(s); //.replaceAll(/([A-Z]?)([a-h][0-8])(x?[a-h][0-8])/g, '$1$3'));
						safe_moves.push(i)
					} else {
						const new_board = board.copy()
						new_board.move(pos, i)
						if (new_board.is_safe(i, depth + 1)) safe_moves.push(i)
					}
				}
				if (!moved) {
					// Can't castle over unsafe space.  // TODO: ???
					const frs = safe_moves.map(i => i2fr(i))
					for (let i = safe_moves.length - 1; i >= 0; --i) {
						const fr = i2fr(safe_moves[i])
						if (
							(fr === 'c8' && frs.indexOf('d8') < 0) ||
							(fr === 'g8' && frs.indexOf('f8') < 0) ||
							(fr === 'c1' && frs.indexOf('d1') < 0) ||
							(fr === 'g1' && frs.indexOf('f1') < 0)
						) safe_moves.splice(i, 1)
					}
				}
				return safe_moves
		}
		// Default linear moves.
		for (const dir of dirs) {
			let tx = x + dir[0]
			let ty = y + dir[1]
			while (1) {
				const piece = this.xy2p(tx, ty)
				if (piece === EMPTY) moves.push(xy2i(tx, ty))
				else if (piece && this.xy2color(tx, ty) !== color) {
					moves.push(xy2i(tx, ty))
					break
				}
				else break

				tx += dir[0]
				ty += dir[1]
			}
		}
		return moves
	}

	b2color = b => this.colors & b ? BLACK : WHITE
	i2color = i => this.colors & i2b(i) ? BLACK : WHITE
	i2moved = i => this.moved & i2b(i) ? true : false
	xy2color = (x, y) => this.colors & xy2b(x, y) ? BLACK : WHITE
	xy2p = (x, y) => {
		if (x < 0 || y < 0 || x > 7 || y > 7) return  // Prevents wrapping in 1D board.
		return this.grid[y * 8 + x]
	}

	is_safe(pos, depth = 0) {
		const color = this.i2color(pos)
		//const enemies = get_pieces(1 - color)
		for (let i = 0; i < 64; ++i) {
			const piece = this.grid[i]
			const target_color = this.i2color(i)
			if (piece === EMPTY || target_color === color) continue
			if (this.get_moves(i, depth + 1).find(j => j === pos)) return false
		}
		return true
	}

	reset() {
		this.bboard = [
			0b00000000_00000000_11111111_11111111_11111111_11111111_00000000_00000000n,  // Empty. TODO: Colors
			0b00000000_11111111_00000000_00000000_00000000_00000000_11111111_00000000n,  // Pawn
			0b10000001_00000000_00000000_00000000_00000000_00000000_00000000_10000001n,  // Rook
			0b01000010_00000000_00000000_00000000_00000000_00000000_00000000_01000010n,  // kNight
			0b00100100_00000000_00000000_00000000_00000000_00000000_00000000_00100100n,  // Bishop
			0b00001000_00000000_00000000_00000000_00000000_00000000_00000000_00001000n,  // Queen
			0b00010000_00000000_00000000_00000000_00000000_00000000_00000000_00010000n,  // King
		]
		this.colors = 0b00000000_00000000_00000000_00000000_00000000_00000000_11111111_11111111n // i = 0 = b 0 = fr a8
		this.moved = 0n

		this.grid = [
			ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK,
			PAWN, PAWN, PAWN, PAWN, PAWN, PAWN, PAWN, PAWN,
			EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
			EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
			EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
			EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY,
			PAWN, PAWN, PAWN, PAWN, PAWN, PAWN, PAWN, PAWN,
			ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK,
		]
		this.log = []
		this.captured = []
		this.depth = 0
	}

	fen_export() {
		let ppd = ''
		for (let row = 0; row < 8; ++row) {
			let spaces = 0
			for (let col = 0; col < 8; ++col) {
				const p = this.grid[row * 8 + col]
				const i = row * 8 + col
				if (p === EMPTY) {
					++spaces
					if (col === 7) ppd += spaces
				} else {
					if (spaces) {
						ppd += spaces
						spaces = 0
					}
					let char = ' PRNBQK'[p]
					ppd += this.colors & i2b(i) ? char.toLowerCase() : char
				}
			}
			if (row < 7) ppd += '/'
		}
		const active_color = 'wb'[this.log.length % 2]
		let castling_availability = ''
		if (!(this.moved & fr2b('e1'))) {
			if (!(this.moved & fr2b('h1'))) castling_availability += 'K'
			if (!(this.moved & fr2b('a1'))) castling_availability += 'Q'
		}
		//if (!(this.moved & 0b00001000_00000000_00000000_00000000_00000000_00000000_00000000_00000000)) {
		if (!(this.moved & (1n << fr2b('e8')))) {
			if (!(this.moved & fr2b('h8'))) castling_availability += 'k'
			if (!(this.moved & fr2b('a8'))) castling_availability += 'q'
		}
		// e.p. square
		let ep_target = '-'
		const mo = this.log[this.log.length - 1]?.match(/^[a-h][27]([a-h][45])/)
		if (mo) {
			if (mo[1][1] === '4') ep_target = mo[1][0] + '3'
			else ep_target = mo[1][0] + '6'
		}
		//
		let halfmove_clock = 0
		for (let i = this.log.length - 1; i >= 0; --i) {
			const s = this.log[i]
			// Reset after capture or pawn move.
			if (s.indexOf('x') > -1 || s.match(/^[a-h]/)) break
			++halfmove_clock
		}
		const fullmove_number = 1 + Math.floor(this.log.length / 2)

		return [ppd, active_color, castling_availability || '-', ep_target, halfmove_clock, fullmove_number].join(' ')
	}

	fen_import(fen) {
		// e.g. "2b5/2p5/4p3/4r1kp/8/5K2/r2q4/8 b KQkq - 0 20" or "8/5k2/3p4/1p1Pp2p/pP2Pp1P/P4P1K/8/8 b - - 99 50"
		const [ppd, active_color, castling_availability, ep_target, halfmove_clock, fullmove_number] = fen.split(' ')
		this.bboard = [0n, 0n, 0n, 0n, 0n, 0n, 0n]
		this.moved = FULL64
		this.log = []
		this.captured = []
		let row = 0
		let col = 0
		for (const line of ppd.split('/')) {
			for (const char of line) {
				let piece = EMPTY
				switch (char) {
					case 'P': case 'p': piece = PAWN; break
					case 'R': case 'r': piece = ROOK; break
					case 'N': case 'n': piece = KNIGHT; break
					case 'B': case 'b': piece = BISHOP; break
					case 'Q': case 'q': piece = QUEEN; break
					case 'K': case 'k': piece = KING; break
					default: col += parseInt(char) - 1
				}
				const bit = xy2b(col, row)
				this.bboard[piece] |= bit
				++col
			}
			col = 0
			++row
		}
		if (castling_availability.indexOf('K') > -1) {
			this.moved &= ~fr2b('e1')
			this.moved &= ~fr2b('h1')
		}
		if (castling_availability.indexOf('Q') > -1) {
			this.moved &= ~fr2b('e1')
			this.moved &= ~fr2b('a1')
		}
		if (castling_availability.indexOf('k') > -1) {
			this.moved &= ~fr2b('e8')
			this.moved &= ~fr2b('a8')
		}
		if (castling_availability.indexOf('q') > -1) {
			this.moved &= ~fr2b('e8')
			this.moved &= ~fr2b('a8')
		}
		const move_count = (fullmove_number - 1) * 2 + (active_color === 'b' ? BLACK : WHITE)
		const hmc = parseInt(halfmove_clock)
		for (let i = 0; i < move_count; ++i) this.log.push(i < (move_count - halfmove_clock) ? 'x' : '?')
		if (ep_target !== '-') {
			const [file, rank] = ep_target
			if (rank === '4') this.log[this.log.length - 1] = `${file}3${file}5`
			else this.log[this.log.length - 1] = `${file}5${file}7`
		}
		render(this)
	}

	get_king = color => this.bboard[KING] & (color ? this.colors : FULL64 - this.colors)
	//get_pieces = color => this.bboard.map(i64 => i64 & (color ? this.colors : ~this.colors))
	get_pieces = color => {
		let res = []
		for (let i = 0; i < 64; ++i) {
			if (this.grid[i] !== EMPTY && this.i2color(i) === color) {
				res.push(i)
			}
		}
		return res
	}

	//get_score = color => this.get_pieces(color).reduce((sum, el) => sum + el.value, 0)
	get_score = color => {
		let total = 0
		for (let i = 0; i < 64; ++i) {
			if (this.i2color(i) !== color) continue
			total += VALUES[board.grid[i]]
		}
		return total
	}

	is_check(color) {  // FIXME
		const king = this.get_king(color)
		return !!king && !board.is_safe(b2i(king))
	}

	is_mate(color) {
		// start = performance.now(); for (let i = 0; i < 100; ++i) board.is_mate(0); console.log(performance.now() - start)
		const iking = b2i(this.get_king(color))
		if (!this.is_check(color)) return false
		if (this.get_moves(iking).length > 0) return false
		// Saving move?
		for (const i in this.grid) {
			const pcolor = this.i2color(i)
			if (pcolor !== color) continue
			const moves = this.get_moves(i)
			for (const j of moves) {
				const new_board = this.copy()
				new_board.move(i, j)
				if (!new_board.is_check(color)) return false
			}
		}
		return true
	}

	copy() {
		const new_board = new Board(this.depth + 1)
		new_board.log = this.log.slice()  // 3 times faster than map(x => x); 30+ times faster than [...log]
		new_board.captured = this.captured.slice()
		new_board.grid = this.grid.slice()
		new_board.bboard = this.bboard.slice()
		new_board.colors = this.colors
		new_board.moved = this.moved
		return new_board
	}

	fr2p(fr) {
		return this.i2p(fr2i(fr))
	}

	b2p = bit => {
		if (this.bboard[PAWN] & bit) return PAWN
		else if (this.bboard[ROOK] & bit) return ROOK
		else if (this.bboard[KNIGHT] & bit) return KNIGHT
		else if (this.bboard[BISHOP] & bit) return BISHOP
		else if (this.bboard[QUEEN] & bit) return QUEEN
		else if (this.bboard[KING] & bit) return KING
		else return EMPTY
	}
	i2p = i => this.grid[i]

	log_check(move, color) {
		let c = ''
		if (this.depth === 0) {
			c = this.is_check(color) ? (this.is_mate(color) ? '#' : '+') : ''
			if (c === '+') say(['White', 'Black'][color] + ' in check.')
			else if (c === '#') {
				c += color ? ' 1-0' : ' 0-1'; say('Checkmate. ' + ['Black', 'White'][color] + ' wins!')
				clearInterval(timer)
			}
		}
		this.log.push(move + c)
	}

	move(from, to, partial = false) {
		const from_bit = i2b(from)
		const to_bit = i2b(to)
		const from_p = this.i2p(from)
		const to_p = this.i2p(to)
		this.moved |= from_bit
		this.bboard[to_p] |= to_bit
		this.bboard[from_p] &= FULL64 ^ from_bit
		const color = this.i2color(from) //(this.colors & from_bit) ? BLACK : WHITE
		if (color) {
			this.colors |= to_bit
		} else {
			this.colors &= FULL64 ^ to_bit
		}
		// no bboard piece so ignored: this.colors &= FULL64 ^ from_bit

		// Easy but possibly slower than bboard.
		this.grid[to] = from_p
		this.grid[from] = EMPTY

		if (this.depth === 0 && to_p !== EMPTY) {
			this.captured.push(to_p)
			say('Took ' + NAMES[to_p])
		}

		const move = CHARS[from_p] + i2fr(from) + (to_p === EMPTY ? '' : 'x') + i2fr(to)
		if (from_p === KING) {
			const rank = color ? 8 : 0
			const [x, y] = i2xy(to)
			if (move === `Ke${rank}c${rank}`) {
				move = '0-0-0'
				if (this.depth === 0) say("Queenside castle.")
				this.move(from, from - 2, true)
			} else if (move === `Ke${rank}g${rank}`) {
				move = '0-0'
				if (this.depth === 0) say("Kingside castle.")
				this.move(from, from + 2, true)
			}
		}

		if (!partial) this.log_check(move, 1 - color)
	}

	promote(bit, kind) {
		this.bboard.map((v, i) => (i === kind) ? (v | bit) : (v & !bit))
	}
}

window.b2i = function (b) {
	let i = 0n
	while ((b >> i) > 1) ++i
	return Number(i)
}
// window.b2i = b => { for(let i = 0; i < 64; ++i) if (i2b(i) === b) return i }
window.b2xy = b => i2xy(b2i(b))

window.i2b = i => 1n << BigInt(i)
window.i2fr = i => {
	let res = "abcdefgh"[i % 8] + (8 - (Math.floor(i / 8)))
	console.assert(res)
	return res
}
window.i2xy = i => [i % 8, Math.floor(i / 8)]

window.fr2b = fr => i2b(fr2i(fr))
window.fr2i = fr => "abcdefgh".indexOf(fr[0]) + 8 * (8 - parseInt(fr[1]))
window.fr2xy = fr => ["abcdefgh".indexOf(fr[0]), 8 - parseInt(fr[1])]

window.xy2b = (x, y) => 1n << BigInt(xy2i(x, y))
window.xy2fr = (x, y) => "abcdefgh"[x] + (8 - y)
window.xy2i = (x, y) => y * 8 + x

window.test_conversions = () => {
	console.assert(b2i(0n) === 0)
	console.assert(b2xy(0n).toString() === "0,0")

	console.assert(i2b(0) === 1n)
	console.assert(i2fr(0) === "a8")
	console.assert(i2xy(0).toString() === "0,0")

	console.assert(fr2b("a8") === 1n)
	console.assert(fr2i("a8") === 0)
	console.assert(fr2xy("a8").toString() === "0,0")

	console.assert(xy2b(0, 0) === 1n)
	console.assert(xy2fr(0, 0) === "a8")
	console.assert(xy2i(0, 0) === 0)

	console.assert(board.xy2p(0, 0) === ROOK)
}

window.grid2s = grid => {
	let res = ''
	for (let i = 0; i < 8; ++i) res += grid.join('').slice(i * 8, i * 8 + 8) + '\n'
	console.log(res)
	return res
}
window.b2s = b => {
	const s = [...b.toString(2).padStart(64, '0')].reverse().join("")
	let text = ''
	for (let i = 0; i < 8; ++i) {
		text += s.slice(i * 8, i * 8 + 8) + '\n'
	}
	console.log(text)
	return text
}
//window.show_color = color => board.get_pieces(color).map(b => b2s(b)).forEach(x => { console.log(x) })

export const ICONS = {
	'0': '♙', '1': '♟︎',
	'R0': '♖', 'R1': '♜',
	'N0': '♘', 'N1': '♞',
	'B0': '♗', 'B1': '♝',
	'Q0': '♕', 'Q1': '♛',
	'K0': '♔', 'K1': '♚',
}
window.p2s = (p, color) => ICONS[CHARS[p] + color]

window.render = board => {
	const grid = board.grid
	const log = board.log

	let files = `<span class="square">` + (` abcdefgh`.split('').join('</span><span class="square">')) + `</span>`
	let lines = [files + `<span id="clock1"></span> <span id="caps1">${board.captured.filter(e => e.color === WHITE).map(e => ICONS[e.char + e.color]).join('')}</span>`]
	for (let row = 0; row < 8; ++row) {
		let line = `<span class="square">${8 - row}</span>`
		for (let col = 0; col < 8; ++col) {
			line += `<span id="${xy2fr(col, row)}" class="square ${'wb'[(row % 2 + col % 2) % 2]}">  </span>`
		}
		line += `<span class="square">${8 - row}</span>`
		lines.push(line)
	}
	lines.push(files + `<span id="clock0"></span> <span id="caps0">${board.captured.filter(e => e.color === BLACK).map(e => ICONS[e.char + e.color]).join('')}</span>`)

	files = ' abcdefgh '
	let blank = ' '
	if (!MONOSPACE) {
		files = ' a b c d e f g h '
		blank = '  '
	}
	let text_lines = [files]
	for (let row = 0; row < 8; ++row) {
		let text_line = COLORS ? `${8 - row}\x1B[30m` : `${8 - row}`
		for (let col = 0; col < 8; ++col) {
			if (COLORS) text_line += ['\x1B[47m', '\x1B[100m'][(row % 2 + col % 2) % 2]
			const p = board.xy2p(col, row)
			const color = board.i2color(xy2i(col, row)) //(board.colors & 1n << BigInt(xy2i(col, row))) ? BLACK : WHITE
			// const char = CHARS[p]
			if (p === EMPTY) {
				text_line += COLORS ? ' ' : ' .'[(row % 2 + col % 2) % 2]
				if (!MONOSPACE) text_line += ' '
				continue
			}
			text_line += p2s(p, color)
			//console.log('index', xy2i(col, row), char + color)
			let html = ''
			if (color) html = `<span class="piece bf">${p2s(p, 1)}</span>`
			else html = `<span class="piece wf">${p2s(p, 1)}</span><span class="piece bf">${p2s(p, 0)}</span>`
			lines.push(`<span id="p${xy2fr(col, row)}" class='piece' style='left: ${1 + parseInt(col)}em; top: ${1 + parseInt(row)}em'>${html}</span>`)
		}
		text_lines.push(text_line + (COLORS ? `\x1B[m${8 - row}` : `${8 - row}`))
	}
	text_lines.push(files)
	clog(text_lines.join('\n'))
	boardtext.innerHTML = lines.join('\n')

	let html = ''
	let txt = ''
	for (let i = 0; i < log.length; i += 2) {
		html += `<li><span onclick="rewind(${i + 1})">${log[i]}</span> <span onclick="rewind(${i + 2})">${log[i + 1] || ''}</span></li>`
		txt += `${1 + i / 2}. ${log[i]} ${log[i + 1] || ''} `
	}
	logtext.innerHTML = `<ol>${html}</ol>`

	clog(board.captured.map(p => ICONS[CHARS[p] + 0]).join(''))
	if (txt.length > 77) clog(`...${txt.slice(-77)}`)
	else clog(txt)

	show_clock()
	document.querySelectorAll('.square').forEach(el => {
		el.onmousedown = function (e) {
			console.log("md")
			e.preventDefault()  // Stop doubleclick select.
		}
		el.onmouseup = async function (e) {
			console.log("mu")
			const [x, y] = fr2xy(this.id)
			const i = xy2i(x, y)
			if (isNaN(y)) return
			if (editmode.checked) {
				document.querySelectorAll('.selected').forEach(el => {
					el.classList.remove('selected')
					el.classList.remove('nobg')
				})
				this.classList.add('selected')
				if (isNaN(i)) return
				let html = `
					<button onclick="setp(${i}, EMPTY); hide_modal()"> </button>
					<button onclick="setp(${i}, KING, 1); hide_modal()">♚</button>
					<button onclick="setp(${i}, QUEEN, 1); hide_modal()">♛</button>
					<button onclick="setp(${i}, BISHOP, 1); hide_modal()">♝</button>
					<button onclick="setp(${i}, KNIGHT, 1); hide_modal()">♞</button>
					<button onclick="setp(${i}, ROOK, 1); hide_modal()">♜</button>
					<button onclick="setp(${i}, PAWN, 1); hide_modal()">♟︎</button><br>
					<button onclick="setp(${i}, KING, 0); hide_modal()">♔</button>
					<button onclick="setp(${i}, QUEEN, 0); hide_modal()">♕</button>
					<button onclick="setp(${i}, BISHOP, 0); hide_modal()">♗</button>
					<button onclick="setp(${i}, KNIGHT, 0); hide_modal()">♘</button>
					<button onclick="setp(${i}, ROOK, 0); hide_modal()">♖</button>
					<button onclick="setp(${i}, PAWN, 0); hide_modal()">♙</button>
					`
				show_modal(html)
				while (getComputedStyle(modal).visibility === 'visible') await (sleep(1000))
				render(board)
				return
			}
			if (this.classList.contains('selected')) {
				if (start_fr && start_fr !== this.id) {
					show_move(start_fr, this.id, true)
					start_fr = null
					return
				}
			}
			document.querySelectorAll('.selected').forEach(el => {
				el.classList.remove('selected')
				el.classList.remove('nobg')
			})
			const piece = board.fr2p(this.id)
			if (piece === EMPTY || this.id === window.start_fr) {
				window.start_fr = null
				return
			}
			window.start_fr = this.id
			this.classList.add('selected')
			const moves = board.get_moves(i)
			const color = board.i2color(i)
			for (const to of moves) {
				// Limit if in check.
				const new_board = board.copy()
				new_board.move(i, to)
				if (new_board.is_check(color)) continue

				const square = document.getElementById(i2fr(to))
				square.classList.add('selected')
				if (!guides.checked) square.classList.add('nobg')
			}
		}
	})
}

function random_choice(array) {
	return array[Math.floor(Math.random() * array.length)]
}

function prune(moves, move) {
	moves = moves.filter(m => m[0] !== move[0] || m[1] !== move[1])
}

window.ai_move = async function ai_move(board, color, start_time, start_score, total) {
	//if (typeof color === "undefined") color = board.log.length % 2
	if (typeof start_score === "undefined") start_score = -999
	if (typeof start_time === "undefined") start_time = performance.now()
	if (typeof total === "undefined") total = [0]
	const depth = board.depth
	const max_secs = parseInt(ai_time.value) * 1000

	let best_score = start_score
	let best_move = null
	let best_piece = null
	let max_think = 128  // offense
	if (false && clock_running[1]) {  // Use timer method as color alternates for each starting move.
		if (depth > 0) max_think = 1  // defense
	} else {
		if (depth === 1) max_think = 128  // defense
		else if (depth > 1) max_think = 8  // trap
	}
	// Breadth first to not make dumb moves; 60 at depth 0 is too little.
	for (let sublevel = 0; sublevel <= 1; ++sublevel) {
		const black_pieces = board.get_pieces(BLACK)
		const white_pieces = board.get_pieces(WHITE)
		let pieces = black_pieces.concat(white_pieces)
		// https://support.chess.com/article/128-what-does-insufficient-mating-material-mean
		if (pieces.length < 3 ||
			((black_pieces.length < 3 && white_pieces.length < 3)
				&& !(board.bboard[PAWN] | board.bboard[ROOK] | board.bboard[QUEEN]))) {
			if (depth === 0) {
				say("Insufficient material to mate; draw.")
				board.log.push('½–½')
				clearInterval(timer)
				render(board)
			}
			return
		}
		let total_moves = 0
		let i_moves = {}
		for (let i = 0; i < 64; ++i) {
			let moves = board.get_moves(i)
			if (moves.length > 0) {  // FIXME: 5 exists but has no moves so can't be pruned.
				total_moves += moves.length
				i_moves[i] = moves
			}
		}
		console.log("i_moves:", JSON.stringify(i_moves))
		prune_pieces(pieces, i_moves)

		for (let i = 0; i < max_think; ++i) {
			if (pieces.length < 1) break
			const from = random_choice(pieces)
			if (from in i_moves === false) continue  // XXX: Should not be needed.
			const to = random_choice(i_moves[from])
			// Eval move.
			++total[0]
			const capture = board.grid[to]
			if (capture === KING) {
				clog("Capturing king.")
				say("You are already dead.")
				best_move = to
				best_piece = from
				break
			}

			const new_board = board.copy()  // TODO: Rewind instead of copying whole board.			
			new_board.move(from, to)
			if (new_board.is_check(color)) {  // Side effect updates piece moves in OO version via is_safe().
				prune(i_moves[from], to)
				prune_pieces(pieces, i_moves)
				continue  // Keep own king safe.
			}

			// Set response.
			let enemy_move = true
			if (false && sublevel > 0) {  // XXX: No recursion while debugging.
				if ((false && clock_running[1] && board.depth < 150)
					|| board.depth < ai_level.value - 1) {
					console.log("Awaiting depth", new_board.depth, "for", color, "start_score", start_score)
					enemy_move = await ai_move(new_board, 1 - color, start_time, start_score, total)  // TODO: Fix OO version.
				}
			}
			const my_score = new_board.get_score(color)
			const enemy_score = new_board.get_score(1 - color)
			const score = my_score - enemy_score
			if (start_score === -999) start_score = score
			if (!enemy_move) {
				// Timeout, draw, or win!
				best_score = score
				best_move = to
				best_piece = from
				if (new_board.is_check(1 - color)) {
					if (new_board.is_mate(1 - color)) break
					if (new_board.is_safe(xy2i(x, y))) best_score = score + 0.5
				} else {
					console.log("No enemy move, but no check either. Timeout?")
					best_score = score - 0.5  // avoid draw
				}
			} else if ((clock_running[1] && depth > 2 && score < start_score) // Our trap backfired. TODO: Keep going until no capture: quescence search?
				|| score <= best_score) {
				if ((clock_running[1] && depth > 2 && score < start_score)) {
					console.log("xtra prune!", score, "<", start_score)
					debugger
				}
				prune(i_moves[from], to)
				prune_pieces(pieces, i_moves)
				continue
			} else if (score > best_score) {
				best_score = score
				best_move = to
				best_piece = from
			}
			const think_time = performance.now() - start_time
			if (think_time > max_secs) {
				console.log("Breaking depth", depth, "sublevel", sublevel, "at", i, "of", total_moves, "after", total[0], "in", (think_time).toFixed(0), "ms")
				break
			}
			if (total[0] % 256 === 0) {  // Just total works as well, but feels unsafe.
				await sleep(1)  // Update GUI.
			}
		}
	}
	// Found best move.
	if (depth > 0) {
		if (best_piece) {
			board.move(best_piece, best_move)
		}
	} else {
		if (best_piece) await show_move(i2fr(best_piece), i2fr(best_move))
		else {
			board.log.push('½–½')
			say(['White', 'Black'][color] + ' is stalemated; draw.')
			clearInterval(timer)
			render(board)
		}
		console.log(`${new Date().toLocaleTimeString()} Level ${ai_level.value} max ${max_think} took ${ms2time(performance.now() - start_time)} to ${best_score}`)
	}
	return best_move
}

window.prune_pieces = (pieces, i_moves) => {
	//console.log("pruning", pieces.slice())
	for (let i = pieces.length; i >= 0; --i) {
		if (!i_moves[i] || i_moves[i].length < 1) pieces.splice(i, 1)
	}
	//pieces = pieces.filter(p => i_moves[p] && i_moves[p].length > 0)
	//console.log("pruned", pieces.slice())
	//return pieces
}

window.say = msg => {
	console.log(msg)
	if (speak.checked) {
		say_it(msg, 1, 1, "en-UK")
	}
}

async function show_move(start_fr, stop_fr, is_human) {
	favicon.href = 'rook.png'
	const from = fr2i(start_fr)
	const to = fr2i(stop_fr)
	const piece = board.i2p(from)
	const color = board.i2color(from)
	const c = CHARS[piece]

	if ((color === BLACK && speak_black.checked) ||
		(color === WHITE && speak_white.checked)) say(`${start_fr} ${stop_fr}`.toUpperCase())

	//render(board)
	await sleep(400)
	const style = document.getElementById('p' + start_fr).style
	const [x, y] = fr2xy(stop_fr)
	style.left = (1 + x) + 'em'
	style.top = (1 + y) + 'em'
	await sleep(400)

	board.move(from, to)
	render(board)
	document.getElementById(start_fr).classList.add('selected')
	document.getElementById(stop_fr).classList.add('selected')

	if (is_human && c === '' && (
		(color === BLACK && y === 7) ||
		(color === WHITE && y === 0))) {
		const i = y * 8 + x
		let html = `
			<button onclick="promote(${bit}, 5)">♛</button>
			<button onclick="promote(${bit}, 4)">♝</button>
			<button onclick="promote(${bit}, 3)">♞</button>
			<button onclick="promote(${bit}, 2)">♜</button>
		`
		show_modal(html)
		while (getComputedStyle(modal).visibility === 'visible') await (sleep(1000))
	}

	if (board.log[board.log.length - 1].indexOf('#') > -1) return
	const max_moves = 75
	if (board.log.length > max_moves && !board.log.slice(-max_moves).some(s => s.indexOf('x') > -1 || s.match(/^[a-h]/))) {
		const msg = `${max_moves} moves without checkmate, capture, or pawn move. Draw.`
		clog(msg)
		say(msg)
		clearInterval(timer)
		return
	}
	start_clock(1 - color)
	if (black_ai_box.checked || white_ai_box.checked) {
		favicon.href = 'think.png'
		if (ai_level.value < 2 || board.log[board.log.length - 1].indexOf('x') > -1) await sleep(1000)
		else await sleep(400)
		if (color === WHITE && black_ai_box.checked) ai_move(board, BLACK)
		else if (color === BLACK && white_ai_box.checked) ai_move(board, WHITE)
	}
}

window.promote = function promote(bit, kind) {
	modal.style.visibility = 'hidden'
	board.promote(bit, kind)
	say('Promote to ' + NAMES[kind])
	board.log_check(board.log.pop() + CHARS[kind], 1 - board.colors[bit])
	render(board)
}

window.setp = (pos, p, color = 0, board_parm = null) => {
	let b = board
	if (board_parm) b = board_parm
	b.grid[pos] = p
	let bit = i2b(pos)
	if (color) b.colors |= bit
	else b.colors &= ~bit
	b.bboard[p] |= bit
}

window.show_modal = (html) => {
	if (getComputedStyle(modal).visibility == 'hidden') {
		modal.innerText = ''
		modal.style.visibility = 'visible'
	}
	const d = document.createElement('div')
	d.className = 'alert'
	d.innerHTML = html
	modal.appendChild(d)
}
window.hide_modal = () => {
	modal.style.visibility = 'hidden'
}

window.timer = null
const clock_start = [0, 0]
const clock_running = [false, false]
const clock_ms = [0, 0]
function start_clock(color) {
	clock_start[color] = performance.now()
	clock_running[color] = true
	clock_running[1 - color] = false
	clock_ms[1 - color] += performance.now() - clock_start[1 - color]
	show_clock()
	clearInterval(timer)
	timer = setInterval(show_clock, 1000)
}
window.show_clock = function show_clock() {
	for (const color of [0, 1]) {
		const el = document.getElementById('clock' + color)
		if (clock_running[color]) el.innerText = ms2time(clock_ms[color] + performance.now() - clock_start[color])
		else el.innerText = ms2time(clock_ms[color])
	}
}

window.ms2time = function ms2time(ms) {
	const secs = ms / 1000
	return ('0' + Math.floor(secs / 60)).slice(-2) + ':' + ('0' + Math.floor(secs % 60)).slice(-2)
}

window.replay = async function replay(movetext, instant) {
	board.reset()
	render(board)
	const bai = black_ai_box.checked
	const wai = white_ai_box.checked
	const spk = speak.checked
	black_ai_box.checked = false
	white_ai_box.checked = false
	speak.checked = false
	const re_move = /^(?<fullmove_number>\d+\.\s*)?(?<char>[B-R]?)(?<from>[a-h]?[1-8]?)(?<attack>x?)(?<to>[a-h][1-8])(?<promo>[B-R]?)/
	let moves = movetext.split(/\s/)  // e.g. 1. e4 Nf6 2. e5 Ne4 3. d3 Nc5 4. d4 Ne4 5. Qd3 d5 6. exd6 Nxd6
	let color = BLACK
	for (let move of moves) {
		if (move === "0-0") {
			if (color === WHITE) move = "Ke8g8"
			else move = "Ke1g1"
		} else if (move === "0-0-0") {
			if (color === WHITE) move = "Ke8c8"
			else move = "Ke1c1"
		}
		if (!re_move.test(move)) continue
		color = 1 - color
		const mo = move.match(re_move)
		if (mo) {
			let from = mo.groups.from
			const to = mo.groups.to
			const promo = mo.groups.promo
			if (from.length < 2) {
				for (let i = 0; i < 64; ++i) {
					if (board.i2color != color) continue
					const p = board.i2p(i)
					if (CHARS[p] !== mo.groups.char) continue

					const p_fr = i2fr(i)
					const frs = board.get_moves(i).map(j => i2fr(j))
					for (const fr of frs) {
						if (fr === to) {
							if (from.length === 0) {
								from = p_fr
								break
							} else if (p_fr.indexOf(from) > -1) {
								from = p_fr
								break
							}
						}
					}
				}
			}
			if (instant) {
				board.move(fr2i(from), fr2i(to))
			} else await show_move(from, to)
			if (promo) {
				board.promote(fr2b(to), promo)
				board.log_check(board.log.pop() + promo, 1 - color)
			}
		}
	}
	if (instant) render(board)
	black_ai_box.checked = bai
	white_ai_box.checked = wai
	speak.checked = spk
}

window.rewind = function rewind(index) {
	replay(board.log.slice(0, index).join(" "), true)
}

window.test = async function test() {
	console.assert(xy2fr(0, 0) === 'a8')
	console.assert(xy2i(0, 0) === 0)
	console.assert(xy2b(0, 0) === 1n)
	console.assert('' + i2xy(0) == '0,0')
	console.assert('' + b2xy(1n) == '0,0')
	console.assert('' + fr2xy('a8') == '0,0')
	console.assert(b2s(1n) === '10000000\n00000000\n00000000\n00000000\n00000000\n00000000\n00000000\n00000000\n')

	console.assert(board.fr2p("e1") === KING)
	const start = performance.now()
	board.fen_import("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
	await replay("1.Nb1a3 Nb8a6 2. d2d4 d7d5 3.Bc1h6 g7xh6 4.Qd1d3 Bf8g7 5. 0-0-0 Ng8f6 6. f2f4 0-0 7. h2h4 Nf6g4 8. f4f5 e7e5 9. f5e6 e.p. f7xe6 10.Qd3g3 Ng4e3 11.Qg3xe3 Qd8xh4 12.Rh1xh4 Rf8xf1 13.Rd1xf1 Bg7xd4 14.Qe3xd4 Na6b4 15.Qd4xb4 a7a5 16.Qb4g4+ Kg8h8", true)
	// 17.Rf1f8# 1-0", true)
	let fen = board.fen_export()
	console.assert(fen === "r1b4k/1pp4p/4p2p/p2p4/6QR/N7/PPP1P1P1/2K2RN1 w - - 2 17")
	console.log(performance.now() - start)
	black_ai_box.checked = false
	white_ai_box.checked = false
	await ai_move(board, WHITE)
	clearTimeout(timer)
	console.log(board.fen_export() === "r1b2R1k/1pp4p/4p2p/p2p4/6QR/N7/PPP1P1P1/2K3N1 b - - 3 17")
	console.log(performance.now() - start)
	// TODO: Don't cap rook in 8/7k/8/8/8/K1n2b2/R7/8 b - - 12 63
}

window.board = new Board()
board.reset()
render(board)
start_clock(WHITE)
if (white_ai_box.checked) ai_move(board, WHITE)

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("serviceWorker.js")
			.catch(err => console.log("service worker not registered", err))
	})
}