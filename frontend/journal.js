// frontend/journal.js

async function applyFilters() {
    // 1. تجميع القيم من حقول البحث
    const filters = new URLSearchParams({
        entry_no: document.getElementById('filterEntryNo').value,
        account: document.getElementById('filterAccount').value,
        user: document.getElementById('filterUser').value,
        date_from: document.getElementById('dateFrom').value,
        date_to: document.getElementById('dateTo').value,
        amount_min: document.getElementById('amountMin').value,
        amount_max: document.getElementById('amountMax').value
    });

    // 2. طلب البيانات من الـ API الذي جهزناه
    const response = await fetch(`/api/journal?${filters.toString()}`);
    const data = await response.json();

    // 3. عرض البيانات في الجدول (تحديث الـ DOM)
    updateJournalTable(data);
}

function updateJournalTable(data) {
    const tableBody = document.getElementById('journalTableBody');
    tableBody.innerHTML = ''; // تفريغ الجدول الحالي

    data.forEach(entry => {
        tableBody.innerHTML += `
            <tr>
                <td>${entry.id}</td>
                <td>${entry.entry_date}</td>
                <td>${entry.debit_account}</td>
                <td>${entry.credit_account}</td>
                <td>${entry.amount}</td>
                <td>${entry.description}</td>
            </tr>
        `;
    });
}