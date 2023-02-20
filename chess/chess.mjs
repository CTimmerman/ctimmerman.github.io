"use strict"
onbeforeunload = () => false

const SAFARI = navigator.userAgent.indexOf('Safari') > -1
const WINDOWS = navigator.userAgent.indexOf('Windows') > -1
const COLORS = navigator.userAgent.indexOf('Chrome') > -1
const MONOSPACE = !WINDOWS
const WHITE = 0
const BLACK = 1

function clog(msg) {
	console.log("%c" + msg, "font-family: monospace; color: black; background-color: white")
}

class Piece {
	constructor(x, y, color, board_in) {
		this.x = x
		this.y = y
		this.color = color ? color : WHITE
		this.board = board_in || board
	}

	copy = board => new this.constructor(this.x, this.y, this.color, board)

	get_moves() {
		const grid = this.board.grid
		const moves = []
		for (const dir of this.dirs) {
			let tx = this.x + dir[0]
			let ty = this.y + dir[1]
			while (1) {
				const piece = this.board.xy2p(tx, ty)
				if (piece === ' ') moves.push([tx, ty])
				else if (piece && piece.color !== this.color) {
					moves.push([tx, ty])
					break
				}
				else break

				tx += dir[0]
				ty += dir[1]
			}
		}
		return moves
	}

	is_safe(depth) {
		const grid = this.board.grid
		for (const row in grid) {
			for (const col in grid) {
				const piece = grid[row][col]
				if (piece == ' ' || piece.color === this.color || piece === this) continue
				if (piece.get_moves(depth).find(xy => xy[0] === this.x && xy[1] === this.y)) return false
			}
		}
		return true
	}

	move(xy, partial) {
		const ox = this.x
		const oy = this.y
		const [x, y] = xy
		this.board.moved |= xy2b(ox, oy)
		this.board.moved |= xy2b(x, y)
		const board = this.board
		const capture = board.grid[y][x]
		const move = this.char + xy2fr(ox, oy) + (capture === ' ' ? '' : 'x') + xy2fr(x, y)
		board.grid[oy][ox] = ' '
		board.grid[y][x] = this
		this.x = x
		this.y = y
		if (this.board.depth === 0 && capture !== ' ') {
			board.captured.push(capture)
			say('Took ' + capture.name)
		}
		if (partial) return move
		else board.log_check(move, 1 - this.color)
	}
}

window.Rook = class extends Piece {
	name = "Rook"
	char = "R"
	value = 5
	dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
}

window.Knight = class extends Piece {
	name = "Knight"
	char = "N"
	value = 3

	get_moves() {
		const moves = []
		for (const dir of [[-2, -1], [-2, 1], [-1, -2], [1, -2], [2, -1], [2, 1], [1, 2], [-1, 2]]) {
			const tx = this.x + dir[0]
			const ty = this.y + dir[1]
			const piece = this.board.xy2p(tx, ty)
			if (piece === ' ' || (piece && piece.color !== this.color)) {
				moves.push([tx, ty])
			}
		}
		return moves
	}
}

window.Bishop = class extends Piece {
	name = "Bishop"
	char = "B"
	value = 3
	dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
}

window.Queen = class extends Piece {
	name = "Queen"
	char = "Q"
	value = 9
	dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [-1, 0], [0, 1], [0, -1]]
}

window.King = class extends Piece {
	name = "King"
	char = "K"
	value = 10  // Officially 0; playwise 3.5 to 4.

	get_moves(depth) {
		if (!depth) depth = 0
		const board = this.board
		const grid = board.grid
		const moves = []
		for (const dir of [[-1, -1], [1, -1], [-1, 1], [1, 1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const tx = this.x + dir[0]
			const ty = this.y + dir[1]
			const piece = board.xy2p(tx, ty)
			if (piece === ' ' || (piece && piece.color !== this.color)) {
				moves.push([tx, ty])
			}
		}
		if (depth > 0) return moves  // Prevent is_safe loop.
		// Castling.
		/* https://chessily.com/learn-chess/king/
		The king and rook have not yet been moved in the game.
		The king is not in check before and immediately after castling.
		The king will not move through a check during castling.
		All squares between the rook and king are empty.
		Castle to checkmate by Paul Morphy vs. Alonzo Morphy, 1-0 Rook odds New Orleans 1858:
		r4b1r/ppp3pp/8/4p3/2Pq4/3P4/PP2QPPP/2k1K2R w K - 0 19
		*/
		const unmoved = !(this.board.moved & xy2b(this.x, this.y))
		if (unmoved && this.is_safe(depth + 1)) {
			if (!(this.board.moved & xy2b(0, this.y))) {
				let clear = true
				for (let i = 1; i < this.x; ++i) {
					if (grid[this.y][i] !== ' ') clear = false
				}
				if (clear) moves.push([2, this.y])
			}
			if (!(this.board.moved & xy2b(7, this.y))) {
				let clear = true
				for (let i = 6; i > this.x; --i) {
					if (grid[this.y][i] !== ' ') clear = false
				}
				if (clear) moves.push([6, this.y])
			}
		}
		// Remove unsafe moves.
		let safe_moves = []
		for (const xy of moves) {
			if (board.xy2p(...xy).char === "K") {
				// Happens in deep thought.
				//const foo = [...board.log]; let i = 1; let j = 0; let s = ''; while (foo.length > 0) { s += `${j}. ${foo.shift() + ' ' + foo.shift()} `; i += 2; j += 1 }; clog(s); //.replaceAll(/([A-Z]?)([a-h][0-8])(x?[a-h][0-8])/g, '$1$3'));
				safe_moves.push(xy)
			} else {
				const new_board = board.copy()
				const new_piece = new_board.grid[this.y][this.x]
				new_piece.move(xy)
				if (new_piece.is_safe(depth + 1)) safe_moves.push(xy)
			}
		}
		if (unmoved) {
			// Can't castle over unsafe space.
			const frs = safe_moves.map(e => xy2fr(...e))
			for (let i = safe_moves.length - 1; i >= 0; --i) {
				const fr = xy2fr(...safe_moves[i])
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

	move(xy) {
		let move = super.move(xy, true)
		const rank = 8 - this.y
		if (move === `Ke${rank}c${rank}`) {
			move = '0-0-0'
			if (this.board.depth === 0) say("Queenside castle.")
			this.board.grid[this.y][0].move([this.x + 1, this.y], true)
		} else if (move === `Ke${rank}g${rank}`) {
			move = '0-0'
			if (this.board.depth === 0) say("Kingside castle.")
			this.board.grid[this.y][7].move([this.x - 1, this.y], true)
		}
		this.board.log_check(move, 1 - this.color)
	}
}

window.Pawn = class extends Piece {
	name = "Pawn"
	char = ""
	value = 1

	get_moves() {
		const board = this.board
		const grid = board.grid
		const log = board.log
		const moves = []
		// Move straight.
		let dirs = this.color ? [[0, 1]] : [[0, -1]]
		for (const dir of dirs) {
			const tx = this.x + dir[0]
			const ty = this.y + dir[1]
			const piece = board.xy2p(tx, ty)
			if (piece === ' ') {
				moves.push([tx, ty])
				if (this.color && this.y === 1 && grid[ty + 1][tx] === ' ') moves.push([tx, ty + 1])
				if (!this.color && this.y === 6 && grid[ty - 1][tx] === ' ') moves.push([tx, ty - 1])
			}
		}
		// Capture diagonally.
		dirs = this.color ? [[-1, 1], [1, 1]] : [[-1, -1], [1, -1]]
		for (const dir of dirs) {
			const tx = this.x + dir[0]
			const ty = this.y + dir[1]
			const piece = board.xy2p(tx, ty)
			if ((piece && piece !== ' ' && piece.color !== this.color)) {
				moves.push([tx, ty])
			}
			// En passant.
			if ((this.color === BLACK && this.y === 4)
				|| (this.color === WHITE && this.y === 3)) {
				const double_jump = xy2fr(tx, this.color ? 6 : 1) + xy2fr(tx, this.color ? 4 : 3)
				if (log.slice(-1)[0] === double_jump) {
					moves.push([tx, ty])
				}
			}
		}
		return moves
	}

	move(xy) {
		super.move(xy)
		const log = this.board.log
		if ((this.y === 0 && this.color === WHITE && white_ai_box.checked)
			|| (this.y === 7 && this.color === BLACK && black_ai_box.checked)) {
			// 8/5KP1/7k/8/6P1/8/8/8 w - - 3 86
			this.board.promote(...xy, 'N', this.color)
			if (this.board.get_king(1 - this.color).is_safe()) {
				this.board.promote(...xy, 'Q', this.color)
			}
			if (this.board.depth === 0) {
				say("Promotion.")
				this.board.log_check(log.pop() + this.board.xy2p(...xy).char, 1 - this.color)
			}
		}
		// En passant.
		if (this.color === BLACK && this.y != 5) return
		if (this.color === WHITE && this.y != 2) return
		const double_jump = xy2fr(this.x, this.color ? 6 : 1) + xy2fr(this.x, this.color ? 4 : 3)
		if (log.slice(-2)[0].slice(0, 4) === double_jump) {
			this.board.grid[this.y + (this.color ? -1 : 1)][this.x] = ' '
			log[log.length - 1] += ' e.p.'
			if (this.board.depth === 0) say("En passant.")
		}
	}
}

class Board {
	grid = [[], [], [], [], [], [], [], []]
	log = []
	captured = []
	moved = 0n

	constructor(depth) {
		this.depth = depth || 0
	}

	reset() {
		this.grid = [
			[new Rook(0, 0, BLACK), new Knight(1, 0, BLACK), new Bishop(2, 0, BLACK), new Queen(3, 0, BLACK), new King(4, 0, BLACK), new Bishop(5, 0, BLACK), new Knight(6, 0, BLACK), new Rook(7, 0, BLACK)],
			[new Pawn(0, 1, BLACK), new Pawn(1, 1, BLACK), new Pawn(2, 1, BLACK), new Pawn(3, 1, BLACK), new Pawn(4, 1, BLACK), new Pawn(5, 1, BLACK), new Pawn(6, 1, BLACK), new Pawn(7, 1, BLACK)],
			[' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
			[' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
			[' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
			[' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '],
			[new Pawn(0, 6), new Pawn(1, 6), new Pawn(2, 6), new Pawn(3, 6), new Pawn(4, 6), new Pawn(5, 6), new Pawn(6, 6), new Pawn(7, 6)],
			[new Rook(0, 7), new Knight(1, 7), new Bishop(2, 7), new Queen(3, 7), new King(4, 7), new Bishop(5, 7), new Knight(6, 7), new Rook(7, 7)],
		]
		this.log = []
		this.captured = []
		this.moved = 0n
	}

	fen_export() {
		let ppd = ''
		for (let row = 0; row < 8; ++row) {
			let spaces = 0
			for (let col = 0; col < 8; ++col) {
				const p = this.grid[row][col]
				if (p === ' ') {
					++spaces
					if (col === 7) ppd += spaces
				} else {
					if (spaces) {
						ppd += spaces
						spaces = 0
					}
					switch (p.char) {
						case '': ppd += p.color ? 'p' : 'P'; break
						case 'R': ppd += p.color ? 'r' : 'R'; break
						case 'N': ppd += p.color ? 'n' : 'N'; break
						case 'B': ppd += p.color ? 'b' : 'B'; break
						case 'Q': ppd += p.color ? 'q' : 'Q'; break
						case 'K': ppd += p.color ? 'k' : 'K'; break
					}
				}
			}
			if (row < 7) ppd += '/'
		}
		const active_color = 'wb'[this.log.length % 2]
		let castling_availability = ''
		//if (!(this.moved & 0b00001000_00000000_00000000_00000000_00000000_00000000_00000000_00000000)) {
		if (!(this.moved & (1n << 60n))) {
			if (!(this.moved & (1n << 63n))) castling_availability += 'K'
			if (!(this.moved & (1n << 56n))) castling_availability += 'Q'
		}
		if (!(this.moved & 16n)) {
			if (!(this.moved & 128n)) castling_availability += 'k'
			if (!(this.moved & 1n)) castling_availability += 'q'
		}

		let ep_target = '-'
		const mo = this.log[this.log.length - 1]?.match(/^[a-h][27]([a-h][45])/)
		if (mo) {
			if (mo[1][1] === '4') ep_target = mo[1][0] + '3'
			else ep_target = mo[1][0] + '6'
		}
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
		this.grid = []
		this.log = []
		this.captured = []
		for (let i = 0; i < 8; ++i) this.grid.push([' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '])
		let row = 0
		let col = 0
		for (const line of ppd.split('/')) {
			for (const char of line) {
				let piece = ' '
				switch (char) {
					case 'r': piece = new Rook(col, row, BLACK); break
					case 'n': piece = new Knight(col, row, BLACK); break
					case 'b': piece = new Bishop(col, row, BLACK); break
					case 'q': piece = new Queen(col, row, BLACK); break
					case 'k': piece = new King(col, row, BLACK); break
					case 'p': piece = new Pawn(col, row, BLACK); break

					case 'R': piece = new Rook(col, row); break
					case 'N': piece = new Knight(col, row); break
					case 'B': piece = new Bishop(col, row); break
					case 'Q': piece = new Queen(col, row); break
					case 'K': piece = new King(col, row); break
					case 'P': piece = new Pawn(col, row); break
					default:
						col += parseInt(char) - 1
				}
				this.grid[row][col] = piece
				++col
			}
			col = 0
			++row
		}

		this.moved = ((1n << 64n) - 1n)
		if (castling_availability.indexOf('K') > -1) {
			this.moved -= xy2b(4, 7)
			this.moved -= xy2b(7, 7)
		}
		if (castling_availability.indexOf('Q') > -1) {
			this.moved -= xy2b(4, 7)
			this.moved -= xy2b(0, 7)
		}
		if (castling_availability.indexOf('k') > -1) {
			this.moved -= xy2b(4, 0)
			this.moved -= xy2b(7, 0)
		}
		if (castling_availability.indexOf('q') > -1) {
			this.moved -= xy2b(4, 0)
			this.moved -= xy2b(0, 0)
		}
		const move_count = (fullmove_number - 1) * 2 + (active_color === 'b' ? 1 : 0)
		const hmc = parseInt(halfmove_clock)
		for (let i = 0; i < move_count; ++i) this.log.push(i < (move_count - halfmove_clock) ? 'x' : '?')
		if (ep_target !== '-') {
			const [file, rank] = ep_target
			if (rank === '4') this.log[this.log.length - 1] = `${file}3${file}5`
			else this.log[this.log.length - 1] = `${file}5${file}7`
		}
		render(this)
	}

	get_king(color) {
		for (const row in this.grid) {
			for (const col in this.grid) {
				const piece = this.grid[row][col]
				if (piece.char === "K" && piece.color === color) return piece
			}
		}
	}

	get_pieces(color) {
		const rv = []
		for (const row in this.grid) {
			for (const col in this.grid) {
				const piece = this.grid[row][col]
				if (piece.color === color) rv.push(piece)
			}
		}
		return rv
	}

	get_score = color => this.get_pieces(color).reduce((sum, el) => sum + el.value, 0)

	is_check(color) {
		const king = this.get_king(color)
		return !!king && !king.is_safe()
	}

	is_mate(color) {
		// start = performance.now(); for (let i = 0; i < 100; ++i) board.is_mate(0); console.log(performance.now() - start)
		const king = this.get_king(color)
		if (!this.is_check(color)) return false
		if (king.get_moves().length > 0) return false
		for (const row in this.grid) {
			for (const col in this.grid) {
				const piece = this.grid[row][col]
				if (piece.color !== color) continue
				const moves = piece.get_moves()
				for (const xy of moves) {
					const new_board = this.copy()
					const new_piece = new_board.grid[row][col]
					new_piece.move(xy)
					if (!new_board.is_check(color)) return false
				}
			}
		}
		return true
	}

	copy() {
		const new_board = new Board(this.depth + 1)
		new_board.log = [...this.log] // this.log.slice(-1)
		new_board.moved = this.moved  // XXX: Forgetting this line leads to random data in fen_export and Qg8 instead of Rf8 in test despite new_board.moved being a 0n bigint here according to Chrome 109.0.5414.120 on Windows 10.0.19044.2486.
		for (const row in this.grid) {
			for (const col in this.grid) {
				const piece = this.grid[row][col]
				if (piece === ' ') {
					new_board.grid[row][col] = ' '
				} else {
					new_board.grid[row][col] = piece.copy(new_board)
				}
			}
		}
		return new_board
	}

	xy2p(x, y) {
		if (x < 0 || x > 7 || y < 0 || y > 7) return ''
		return this.grid[y][x]
	}

	fr2p(fr) {
		const xy = fr2xy(fr)
		if (xy[0] >= 0 && xy[1] >= 0) return this.grid[xy[1]][xy[0]]
		return ''
	}

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

	promote(x, y, kind, color) {
		switch (kind) {
			case 'Q':
				this.grid[y][x] = new Queen(x, y, color)
				break
			case 'B':
				this.grid[y][x] = new Bishop(x, y, color)
				break
			case 'N':
				this.grid[y][x] = new Knight(x, y, color)
				break
			case 'R':
				this.grid[y][x] = new Rook(x, y, color)
				break
		}
	}
}
window.get_moves = () => {
	let m = []
	for (let p of board.get_pieces(0).concat(board.get_pieces(1))) m = m.concat(p.get_moves())
	return m
}
window.blog = b => {
	const s = b.toString(2).padStart(64, '0')
	let text = ''
	for (let row = 7; row >= 0; --row) {
		for (let col = 7; col >= 0; --col) {
			let i = xy2i(col, row)
			text += s.slice(i, i + 1)
		}
		text += '\n'
	}
	console.log(text)
}
window.fr2xy = fr => ["abcdefgh".indexOf(fr[0]), 8 - parseInt(fr[1])]
window.xy2fr = (x, y) => "abcdefgh"[x] + (8 - y)
window.xy2b = (x, y) => 1n << BigInt(xy2i(x, y))
window.xy2i = (x, y) => y * 8 + x

const icons = {
	'0': '♙', '1': '♟︎',
	'R0': '♖', 'R1': '♜',
	'N0': '♘', 'N1': '♞',
	'B0': '♗', 'B1': '♝',
	'Q0': '♕', 'Q1': '♛',
	'K0': '♔', 'K1': '♚',
}

window.render = board => {
	const grid = board.grid
	const log = board.log

	let files = `<span class="square">` + (` abcdefgh`.split('').join('</span><span class="square">')) + `</span>`
	let lines = [files + `<span id="clock1"></span> <span class="wf">${board.captured.filter(e => e.color === WHITE).map(e => icons[e.char + 1]).join('')}</span>`]
	for (const row in grid) {
		let line = `<span class="square">${8 - row}</span>`
		for (const col in grid) {
			line += `<span id="${xy2fr(col, row)}" class="square ${'wb'[(row % 2 + col % 2) % 2]}">  </span>`
		}
		line += `<span class="square">${8 - row}</span>`
		lines.push(line)
	}
	lines.push(files + `<span id="clock0"></span> <span class="bf">${board.captured.filter(e => e.color === BLACK).map(e => icons[e.char + 1]).join('')}</span>`)

	files = ' abcdefgh '
	let blank = ' '
	if (!MONOSPACE) {
		files = ' a b c d e f g h '
		blank = '  '
	}
	let text_lines = [files]
	for (const row in grid) {
		let text_line = COLORS ? `${8 - row}\x1B[30m` : `${8 - row}`
		for (const col in grid) {
			if (COLORS) text_line += ['\x1B[47m', '\x1B[100m'][(row % 2 + col % 2) % 2]
			const p = grid[row][col]
			if (p === ' ') {
				text_line += COLORS ? ' ' : ' .'[(row % 2 + col % 2) % 2]
				if (!MONOSPACE) text_line += ' '
				continue
			}
			text_line += icons[p.char + p.color]
			let html = ''
			if (p.color) html = `<span class="piece bf">${icons[p.char + '1']}</span>`
			else html = `<span class="piece wf">${icons[p.char + '1']}</span><span class="piece bf">${icons[p.char + '0']}</span>`
			lines.push(`<div id="p${xy2fr(col, row)}" class='piece' style='left: ${1 + parseInt(col)}em; top: ${1 + parseInt(row)}em'>${html}</div>`)
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

	clog(board.captured.map(e => icons[e.char + e.color]).join(''))
	if (txt.length > 77) clog(`...${txt.slice(-77)}`)
	else clog(txt)

	show_clock()
	document.querySelectorAll('.square').forEach(el => {
		el.onmousedown = function (e) {
			e.preventDefault()  // Stop doubleclick select.
		}
		el.onmouseup = async function (e) {
			if (editmode.checked) {
				document.querySelectorAll('.selected').forEach(el => {
					el.classList.remove('selected')
					el.classList.remove('nobg')
				})
				this.classList.add('selected')
				const [x, y] = fr2xy(this.id)
				if (isNaN(y)) return
				let html = `
					<button onclick="board.grid[${y}][${x}] = ' '; hide_modal()"> </button>
					<button onclick="board.grid[${y}][${x}] = new King(${x}, ${y}, 1); hide_modal()">♚</button>
					<button onclick="board.grid[${y}][${x}] = new Queen(${x}, ${y}, 1); hide_modal()">♛</button>
					<button onclick="board.grid[${y}][${x}] = new Bishop(${x}, ${y}, 1); hide_modal()">♝</button>
					<button onclick="board.grid[${y}][${x}] = new Knight(${x}, ${y}, 1); hide_modal()">♞</button>
					<button onclick="board.grid[${y}][${x}] = new Rook(${x}, ${y}, 1); hide_modal()">♜</button>
					<button onclick="board.grid[${y}][${x}] = new Pawn(${x}, ${y}, 1); hide_modal()">♟︎</button><br>
					<button onclick="board.grid[${y}][${x}] = new King(${x}, ${y}, 0); hide_modal()">♔</button>
					<button onclick="board.grid[${y}][${x}] = new Queen(${x}, ${y}, 0); hide_modal()">♕</button>
					<button onclick="board.grid[${y}][${x}] = new Bishop(${x}, ${y}, 0); hide_modal()">♗</button>
					<button onclick="board.grid[${y}][${x}] = new Knight(${x}, ${y}, 0); hide_modal()">♘</button>
					<button onclick="board.grid[${y}][${x}] = new Rook(${x}, ${y}, 0); hide_modal()">♖</button>
					<button onclick="board.grid[${y}][${x}] = new Pawn(${x}, ${y}, 0); hide_modal()">♙</button>
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
			if (!piece || piece === ' ' || this.id === window.start_fr) {
				window.start_fr = null
				return
			}
			window.start_fr = this.id
			this.classList.add('selected')
			const moves = piece.get_moves()
			for (const xy of moves) {
				// Limit if in check.
				const new_board = board.copy()
				const new_piece = new_board.grid[piece.y][piece.x]
				new_piece.move(xy)
				if (new_board.is_check(piece.color)) continue

				const square = document.getElementById(xy2fr(...xy))
				square.classList.add('selected')
				if (!guides.checked) square.classList.add('nobg')
			}
		}
	})
}

function random_choice(array) {
	return array[Math.floor(Math.random() * array.length)]
}

function prune_move(piece, move) {
	piece.moves = piece.moves.filter(m => m[0] !== move[0] || m[1] !== move[1])
}

window.ai_move = async function ai_move(board, color, start_time, total) {
	//if (typeof color === "undefined") color = board.log.length % 2
	if (typeof start_time === "undefined") start_time = performance.now()
	if (typeof total === "undefined") total = [0]
	const depth = board.depth
	const max_secs = parseInt(ai_time.value) * 1000
	let pieces = board.get_pieces(color)
	// https://support.chess.com/article/128-what-does-insufficient-mating-material-mean
	if (pieces.length < 3) {
		const black_pieces = board.get_pieces(BLACK)
		const white_pieces = board.get_pieces(WHITE)
		if ((black_pieces.length + white_pieces.length) < 3 ||
			((black_pieces.length < 3 && white_pieces.length < 3)
				&& !black_pieces.concat(white_pieces).some(p => 'RQ'.indexOf(p.char) > -1))) {
			if (depth === 0) {
				say("Insufficient material to mate; draw.")
				board.log.push('½–½')
				clearInterval(timer)
				render(board)
			}
			return
		}
	}

	let total_moves = 0
	pieces.forEach(p => { p.moves = p.get_moves(); total_moves += p.moves.length })
	pieces = pieces.filter(p => p.moves.length > 0)

	let best_score = -999
	let best_move = null
	let best_piece = null
	let max_think = 128  // offense
	if (depth === 1) max_think = 128  // defense
	else if (depth > 1) max_think = 8  // trap
	for (let i = 0; i < max_think; ++i) {
		++total[0]
		if (pieces.length < 1) break
		const piece = random_choice(pieces)
		const move = random_choice(piece.moves)
		// Eval move.
		const new_board = board.copy()
		const new_piece = new_board.grid[piece.y][piece.x]
		const capture = new_board.grid[move[1]][move[0]]
		if (capture.char === "K") {
			clog("Capturing king.")
			say("You are already dead.")
			best_move = move
			best_piece = piece
			break
		}
		new_piece.move(move)
		if (new_board.is_check(color)) {
			prune_move(piece, move)
			pieces = pieces.filter(p => p.moves.length > 0)
			continue  // Keep own king safe.
		}
		if (new_board.is_check(1 - color)) {
			if (new_board.is_mate(1 - color)) {
				best_score = 999
				best_move = move
				best_piece = piece
				//console.log("Found mate!", new_board.moved, new_board.fen_export())
				// Found mate! 13810387119856777722n r1b2R1k/1pp4p/4p2p/p2p4/6QR/N7/PPP1P1P1/2K3N1 b - - 3 17
				// bad moved = 274877907008n
				// better moved = 2305843009213693984n
				// best moved = 13810387119856777722n
				break
			}
		}
		// Set response. TODO: pass breadth first to not make dumb moves? 60 at depth 0 is too little.
		let enemy_move = false
		if (board.depth < ai_level.value - 1) {
			//console.log("Awaiting depth", new_board.depth)
			enemy_move = await ai_move(new_board, 1 - color, start_time, total)
		}
		const my_score = new_board.get_score(color)
		const enemy_score = new_board.get_score(1 - color)
		let score = my_score - enemy_score
		//console.log("" + depth, piece.name, "move", xy2fr(...move), "score", score, enemy_move)
		if (!enemy_move) {
			// Draw or timeout. TODO: check timeout
			//console.log("Lowering", score)
			//score -= 0.5  // avoid draw
		}
		if (score <= best_score) {
			prune_move(piece, move)
			pieces = pieces.filter(p => p.moves.length > 0)
			continue
		} else if (score > best_score) {
			best_score = score
			best_move = move
			best_piece = piece
		}
		const think_time = performance.now() - start_time
		if (think_time > max_secs) {
			console.log("Breaking depth", depth, "at", i, "of", total_moves, "after", total[0], "in", think_time / 1000, "s")
			break
		}
		if (total[0] % 256 === 0) {  // Just total works as well, but feels unsafe.
			await sleep(1)  // Update GUI.
		}
	}
	if (depth > 0) {
		if (best_piece) best_piece.move(best_move)
	} else {
		if (best_piece) await show_move(xy2fr(best_piece.x, best_piece.y), xy2fr(...best_move))
		else {
			board.log.push('½–½')
			say('Draw.')
			clearInterval(timer)
			render(board)
		}
		console.log(`${new Date().toLocaleTimeString()} Level ${ai_level.value} max ${max_think} of ${total_moves} took ${ms2time(performance.now() - start_time)} to ${best_score}`)
	}
	return best_move
}

import sleep from '/lib/sleep.mjs'
import say_it from '/lib/say.mjs'
window.say = msg => {
	console.log(msg)
	if (speak.checked) {
		say_it(msg, WINDOWS ? 1.9 : 1, 1, "en-UK")
	}
}

async function show_move(start_fr, stop_fr, is_human) {
	favicon.href = 'rook.png'
	const piece = board.fr2p(start_fr)
	const c = piece.char
	const color = piece.color

	if ((color === BLACK && speak_black.checked) ||
		(color === WHITE && speak_white.checked)) say(`${start_fr} ${stop_fr}`.toUpperCase())  // Even uppercase fails "a7 a5" on MacOS!

	//render(board)
	await sleep(400)
	const style = document.getElementById('p' + start_fr).style
	const [x, y] = fr2xy(stop_fr)
	style.left = (1 + x) + 'em'
	style.top = (1 + y) + 'em'
	await sleep(400)

	piece.move(fr2xy(stop_fr))
	render(board)
	document.getElementById(start_fr).classList.add('selected')
	document.getElementById(stop_fr).classList.add('selected')

	if (is_human && c === '' && (
		(color === BLACK && y === 7) ||
		(color === WHITE && y === 0))) {
		let html = `
			<button onclick="promote(${x}, ${y}, 'Q', ${color})">♛</button>
			<button onclick="promote(${x}, ${y}, 'B', ${color})">♝</button>
			<button onclick="promote(${x}, ${y}, 'N', ${color})">♞</button>
			<button onclick="promote(${x}, ${y}, 'R', ${color})">♜</button>
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

window.promote = function promote(x, y, kind, color) {
	modal.style.visibility = 'hidden'
	board.promote(x, y, kind, color)
	say('Promote to ' + board.xy2p(x, y).name)
	board.log_check(board.log.pop() + kind, 1 - color)
	render(board)
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
				const pieces = board.get_pieces(color)
				for (const p of pieces) {
					if (p.char !== mo.groups.char) continue
					const p_fr = xy2fr(p.x, p.y)
					const frs = p.get_moves().map(xy => xy2fr(...xy))
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
				board.fr2p(from).move(fr2xy(to))
			} else await show_move(from, to)
			if (promo) {
				board.promote(...fr2xy(to), promo, color)
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
	const start = performance.now()
	for (let i = 0; i < 20; ++i) {
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
	}
	console.log(board.fen_export() === "r1b2R1k/1pp4p/4p2p/p2p4/6QR/N7/PPP1P1P1/2K3N1 b - - 3 17")
	console.log(performance.now() - start)
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