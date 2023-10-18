window.load_file = async (e) => {
	e.preventDefault()
	e.stopPropagation()
	const file = e.dataTransfer ? await e.dataTransfer.files[0] : e.srcElement.files[0]
	const target = file.name.toUpperCase().endsWith(".FEN") ? fenbox : movetextbox
	target.value = await file.text()
}

let dropTarget = null

window.addEventListener("dragenter", e => {
	dropzone.style.visibility = "visible"
	dropTarget = e.target
})

window.addEventListener("dragleave", e => {
	if (e.target === dropTarget || e.target === document) {
		dropzone.style.visibility = "hidden"
	}
})

window.addEventListener("dragover", e => e.preventDefault()) // Breaks drop if not present!
window.addEventListener("drop", e => {
	e.preventDefault()
	dropzone.style.visibility = "hidden"
	load_file(e)
})