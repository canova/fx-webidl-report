document.addEventListener("DOMContentLoaded", () => {
  // Sortable table columns
  document.querySelectorAll(".report-table th").forEach((th, idx) => {
    th.addEventListener("click", () => {
      const table = th.closest("table");
      const tbody = table.tBodies[0];
      const rows = Array.from(tbody.rows);
      const asc = !th.asc;
      rows.sort((a, b) => {
        const aText = a.cells[idx].innerText.trim();
        const bText = b.cells[idx].innerText.trim();
        return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
      });
      th.asc = asc;
      rows.forEach((r) => tbody.appendChild(r));
    });
  });

  // Filter logic
  const filterInput = document.getElementById("filterInput");
  // Function to apply filter and expand/collapse sections
  function applyFilter() {
    const query = filterInput.value.toLowerCase();
    // Filter rows
    document.querySelectorAll(".report-table tbody tr").forEach((row) => {
      const text = row.innerText.toLowerCase();
      row.style.display = text.includes(query) ? "" : "none";
    });
    // Expand/collapse sections based on visible rows
    document.querySelectorAll("details").forEach((section) => {
      const rowsInSection = section.querySelectorAll("tbody tr");
      const hasMatch = Array.from(rowsInSection).some(
        (r) => r.style.display !== "none",
      );
      section.open = hasMatch;
    });
  }

  // Read initial filter from URL params
  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get("filter") || "";
  filterInput.value = initialQuery;
  applyFilter();

  // Update URL and reapply filter on input
  filterInput.addEventListener("input", () => {
    const query = filterInput.value;
    const newParams = new URLSearchParams(window.location.search);
    if (query) {
      newParams.set("filter", query);
    } else {
      newParams.delete("filter");
    }
    const newUrl =
      window.location.pathname +
      (newParams.toString() ? "?" + newParams.toString() : "");
    window.history.replaceState(null, "", newUrl);
    applyFilter();
  });

  const expandAllBtn = document.getElementById("expand‐all");
  const collapseAllBtn = document.getElementById("collapse‐all");

  expandAllBtn.addEventListener("click", () => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });

  collapseAllBtn.addEventListener("click", () => {
    document.querySelectorAll("details").forEach((d) => (d.open = false));
  });
});
