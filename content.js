console.log("UEK Planner: Multi-Room Mode Aktywny");

// --- FUNKCJE POMOCNICZE ---

// Wyciąga dane z HTML innej strony (np. pobranej przez fetch)
function parseTableFromHTML(htmlString, url) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const table = doc.querySelector('table[border="1"]');
    if (!table) return [];

    const headerInfo = doc.querySelector('.grupa')?.innerText.trim() || "Nieznana sala";
    const rows = Array.from(table.querySelectorAll('tbody tr')).slice(1);
    const headers = Array.from(table.querySelectorAll('th')).map(h => h.innerText.toLowerCase());
    
    const idxPrzedmiot = headers.indexOf('przedmiot');
    const idxNauczyciel = headers.indexOf('nauczyciel');
    const idxGrupa = headers.indexOf('grupa');
    const idxSala = headers.indexOf('sala');

    return rows.filter(r => !r.querySelector('.uwagi')).map(row => {
        const cells = row.querySelectorAll('td');
        return {
            termin: cells[0]?.innerText.trim(),
            czas: cells[1]?.innerText.match(/\d{2}:\d{2} - \d{2}:\d{2}/)?.[0],
            przedmiot: cells[idxPrzedmiot]?.innerText.trim(),
            sala: (idxSala !== -1) ? cells[idxSala].innerText.trim() : headerInfo,
            prowadzacy: (idxNauczyciel !== -1) ? cells[idxNauczyciel].innerText.split('(')[0].trim() : "---",
            grupa: (idxGrupa !== -1) ? cells[idxGrupa].innerText.trim() : ""
        };
    });
}

// --- LOGIKA ZAPISYWANIA ---

async function saveCurrentRoom() {
    const headerInfo = document.querySelector('.grupa')?.innerText.trim();
    const currentUrl = window.location.href;

    if (!headerInfo || !currentUrl.includes('id=')) {
        alert("To nie wygląda na stronę konkretnej sali/planu.");
        return;
    }

    const data = await chrome.storage.local.get(['savedRooms']);
    let rooms = data.savedRooms || [];

    if (!rooms.find(r => r.url === currentUrl)) {
        rooms.push({ name: headerInfo, url: currentUrl });
        await chrome.storage.local.set({ savedRooms: rooms });
        alert(`Dodano salę: ${headerInfo}`);
        renderUI();
    } else {
        alert("Ta sala jest już na liście.");
    }
}

// --- GENEROWANIE ZBIORCZEGO HARMONOGRAMU ---

async function generateMultiSchedule() {
    const data = await chrome.storage.local.get(['savedRooms']);
    const rooms = data.savedRooms || [];
    if (rooms.length === 0) return alert("Najpierw dodaj jakieś sale przyciskiem 'Zapisz tę salę'.");

    document.body.style.cursor = 'wait';
    let allEvents = [];

    // Pobierz dane ze wszystkich zapisanych linków
    for (const room of rooms) {
        try {
            const response = await fetch(room.url);
            const html = await response.text();
            const events = parseTableFromHTML(html, room.url);
            allEvents = allEvents.concat(events);
        } catch (e) {
            console.error("Błąd pobierania dla " + room.name, e);
        }
    }

    renderMatrix(allEvents);
    document.body.style.cursor = 'default';
}
// 1. Przenosimy funkcję drukowania do zwykłej funkcji (nie musi być w window)
function printDay(dayId, dayDate) {
    const container = document.getElementById(dayId);
    if (!container) return;
    
    const content = container.innerHTML;
    const printWindow = window.open('', '_blank', 'height=600,width=800');
    
    printWindow.document.write(`
        <html>
            <head>
                <title>Plan UEK - ${dayDate}</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; }
                    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
                    th, td { border: 1px solid #000; padding: 8px; text-align: center; font-size: 10px; word-wrap: break-word; }
                    th { background-color: #f2f2f2 !important; -webkit-print-color-adjust: exact; }
                    h3 { color: #0056a3; margin-bottom: 10px; }
                    @page { size: landscape; margin: 1cm; }
                </style>
            </head>
            <body>
                <h3>📅 Plan zajęć na dzień: ${dayDate}</h3>
                ${content}
                <script>
                    setTimeout(() => { 
                        window.print(); 
                        window.close(); 
                    }, 500);
                </script>
            </body>
        </html>
    `);
    printWindow.document.close();
}
function renderMatrix(data) {
    const sale = [...new Set(data.map(d => d.sala))].sort();
    const daty = [...new Set(data.map(d => d.termin))].sort().slice(0, 7);
    const timeSlots = [
        "08:00 - 08:45", "08:45 - 09:30", "09:45 - 10:30", "10:30 - 11:15", 
        "11:30 - 12:15", "12:15 - 13:00", "13:15 - 14:00", "14:00 - 14:45",
        "15:00 - 15:45", "15:45 - 16:30", "16:45 - 17:30", "17:30 - 18:15",
        "18:30 - 19:15", "19:15 - 20:00", "20:15 - 21:00"
    ];

    const isSlotOccupied = (slotStr, eventInterval) => {
        const toMin = (t) => { const [h, m] = t.trim().split(':').map(Number); return h * 60 + m; };
        const [sSlot, eSlot] = slotStr.split(' - ').map(toMin);
        const [sEvent, eEvent] = eventInterval.split(' - ').map(toMin);
        const midSlot = sSlot + 5; 
        return midSlot >= sEvent && midSlot < eEvent;
    };

    let html = `<div style="font-family: 'Segoe UI', Tahoma, sans-serif; padding: 20px; background: #fff;">
                <h2 style="color: #0056a3; border-bottom: 3px solid #0056a3; padding-bottom: 10px;">Harmonogram Lekcyjny</h2>`;
    
    daty.forEach((dataDnia, index) => {
        const dayContainerId = `day-container-${index}`;
        
        html += `
        <div style="display: flex; justify-content: space-between; align-items: center; background: #444; color: white; padding: 8px 15px; margin-top: 35px; border-radius: 6px 6px 0 0;">
            <h3 style="margin: 0; font-size: 16px;">📅 ${dataDnia}</h3>
            <button class="uek-print-btn" data-target="${dayContainerId}" data-date="${dataDnia}"
                    style="padding: 5px 15px; background: #fff; color: #333; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;">
                🖨️ Drukuj dzień
            </button>
        </div>
        <div id="${dayContainerId}" style="overflow-x: auto; border: 1px solid #ccc; margin-bottom: 20px;">
            <table style="border-collapse: collapse; width: 100%; text-align: center; table-layout: fixed; min-width: ${sale.length * 150}px;">
                <thead>
                    <tr style="background: #f0f0f0;">
                        <th style="background: #eee; padding: 10px; border: 1px solid #bbb; width: 100px; font-size: 12px;">Godzina</th>
                        ${sale.map(s => `<th style="background: #eee; padding: 10px; border: 1px solid #bbb; font-size: 11px;">${s}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>`;

        timeSlots.forEach((slot, slotIdx) => {
            html += `<tr>
                <td style="font-weight: bold; background: #f9f9f9; border: 1px solid #ddd; padding: 8px; font-size: 11px;">${slot}</td>`;
            
            sale.forEach(s => {
                const event = data.find(d => d.termin === dataDnia && d.sala === s && isSlotOccupied(slot, d.czas));
                
                if (event) {
                    const prevSlot = timeSlots[slotIdx - 1];
                    const nextSlot = timeSlots[slotIdx + 1];
                    const isContinuation = prevSlot && isSlotOccupied(prevSlot, event.czas);
                    const willContinue = nextSlot && isSlotOccupied(nextSlot, event.czas);

                    // --- PRZYWRÓCONE JASNE STYLOWANIE ---
                    const cellStyle = [
                        `background: #e7f3ff !important`, // Jasny błękit tła
                        `color: #333`,                     // Ciemny tekst
                        `border-left: 1px solid #cee4ff`,  // Jasne obramowanie boczne
                        `border-right: 1px solid #cee4ff`,
                        `padding: 4px`,
                        `vertical-align: middle`,
                        // Ukrywanie linii poziomych wewnątrz bloku (używamy białej linii, żeby zlała się z tłem)
                        isContinuation ? `border-top: 1px solid #e7f3ff` : `border-top: 1px solid #cee4ff`,
                        willContinue ? `border-bottom: 1px solid #e7f3ff` : `border-bottom: 1px solid #cee4ff`,
                        `-webkit-print-color-adjust: exact`
                    ].join(';');

                    html += `<td style="${cellStyle}">
                        ${!isContinuation ? `
                            <div style="font-size: 9px; font-weight: bold; color: #0056a3;">⌚ ${event.czas}</div>
                            <div style="font-weight: bold; font-size: 11px; color: #b71c1c; margin-top: 2px;">${event.prowadzacy}</div>
                            <div style="font-size: 9px; margin-top: 2px;">${event.przedmiot}</div>
                        ` : ''}
                    </td>`;
                } else {
                    html += `<td style="border: 1px solid #eee; background: #fff;"></td>`;
                }
            });
            html += `</tr>`;
        });
        html += `</tbody></table></div>`;
    });

    const container = document.getElementById('matrix-container') || document.createElement('div');
    container.id = 'matrix-container';
    container.innerHTML = html;
    
    const oldTable = document.querySelector('table[border="1"]');
    if(oldTable) {
        oldTable.parentNode.insertBefore(container, oldTable);
        oldTable.style.display = 'none';
    }

    // Obsługa drukowania (bez onclick, boIsolated World)
    container.querySelectorAll('.uek-print-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const dayDate = this.getAttribute('data-date');
            printDay(targetId, dayDate);
        });
    });
}


// Musimy wystawić funkcję drukowania do obiektu window, aby przyciski HTML mogły ją odpalić
window.printDaySection = printDay;

async function renderUI() {
    let oldPanel = document.getElementById('uek-helper-panel');
    if (oldPanel) oldPanel.remove();

    const data = await chrome.storage.local.get(['savedRooms']);
    const rooms = data.savedRooms || [];

    const panel = document.createElement('div');
    panel.id = 'uek-helper-panel';
    panel.style = "background: #fff; padding: 15px; border: 2px solid #0056a3; margin: 10px 0; border-radius: 8px; position: sticky; top: 0; z-index: 1000; box-shadow: 0 4px 10px rgba(0,0,0,0.1);";
    
    panel.innerHTML = `
        <div style="margin-bottom: 10px;">
            <button id="btnSaveRoom" style="padding: 8px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">➕ Zapisz tę salę do obserwowanych</button>
            <button id="btnGenMulti" style="padding: 8px; background: #0056a3; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📊 Generuj Harmonogram (Zapisane: ${rooms.length})</button>
            <button id="btnClearRooms" style="padding: 8px; background: #666; color: white; border: none; border-radius: 4px; cursor: pointer;">🗑️ Wyczyść listę</button>
        </div>
        <div style="font-size: 11px; color: #666;">Zapisane: ${rooms.map(r => r.name.split(' ')[0]).join(', ')}</div>
    `;

    const target = document.querySelector('.grupa');
    if (target) target.parentNode.insertBefore(panel, target.nextSibling);

    document.getElementById('btnSaveRoom').onclick = saveCurrentRoom;
    document.getElementById('btnGenMulti').onclick = generateMultiSchedule;
    document.getElementById('btnClearRooms').onclick = async () => {
        if(confirm("Wyczyścić listę zapisanych sal?")) {
            await chrome.storage.local.set({ savedRooms: [] });
            renderUI();
        }
    };
}

renderUI();