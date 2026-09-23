#!/usr/bin/env python3
"""
Generate the sample dataset that backs the AppSource sample report.

Partner Center requires a .pbix that demonstrates the visual and works offline with
no external connection. A .pbix is a binary with a compiled model inside it and
cannot be authored here, so this writes the two things Power BI Desktop needs to
produce one in a couple of minutes: the data as CSV, and the same data as a Power
Query script with the rows embedded as a literal - paste that into a Blank Query
and the model has no file path and no connection to anything.

The shape is a deliberately small HR fact table at (employee x month) grain, which
is the grain the Darwinbox Self BI dashboards use and the grain that exercises the
visual's staged roll-up: a point-in-time headcount that must not be summed across
months, and a ratio that must not be summed at all.
"""
import csv
import os
import random
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "appsource", "sample-report")
os.makedirs(OUT, exist_ok=True)

random.seed(20260923)

DEPARTMENTS = [
    ("Engineering", 26), ("Customer Success", 14), ("Sales", 18), ("Finance", 9),
    ("Human Resources", 7), ("Marketing", 8), ("Operations", 12), ("Legal", 4),
]
LOCATIONS = ["Hyderabad", "Bengaluru", "Mumbai", "Singapore", "Remote"]
EMPLOYMENT = ["Permanent", "Contract"]
GENDERS = ["Female", "Male"]
BANDS = ["B1 - Associate", "B2 - Senior", "B3 - Lead", "B4 - Manager", "B5 - Director"]
DESIGNATIONS = {
    "B1 - Associate": "Associate",
    "B2 - Senior": "Senior Associate",
    "B3 - Lead": "Team Lead",
    "B4 - Manager": "Manager",
    "B5 - Director": "Director",
}
MANAGERS = ["A. Rao", "S. Pereira", "M. Iyer", "K. Nair", "D. Baghel", "R. Kumar"]

MONTHS = [date(y, m, 1) for y in (2025, 2026) for m in range(1, 13)][:21]

rows = []
emp_no = 1000
for dept, headcount in DEPARTMENTS:
    for _ in range(headcount):
        emp_no += 1
        band = random.choices(BANDS, weights=[36, 28, 18, 12, 6])[0]
        joined_at = random.randrange(0, len(MONTHS) - 2)
        tenure_start = random.uniform(0.3, 11.0)
        # a quarter of the population leaves at some point in the window
        leaves_at = (
            random.randrange(joined_at + 2, len(MONTHS))
            if random.random() < 0.25
            else len(MONTHS)
        )
        doj = date(2026 - int(tenure_start) - 1, random.randint(1, 12), random.randint(1, 28))
        emp = {
            "EmployeeId": f"E{emp_no}",
            "EmployeeName": f"Employee {emp_no}",
            "Department": dept,
            "Location": random.choice(LOCATIONS),
            "EmploymentType": random.choices(EMPLOYMENT, weights=[78, 22])[0],
            "Gender": random.choice(GENDERS),
            "Band": band,
            "Designation": DESIGNATIONS[band],
            "L1Manager": random.choice(MANAGERS),
            "DateOfJoining": doj.isoformat(),
        }
        for i, month in enumerate(MONTHS):
            active = joined_at <= i < leaves_at
            exited = i == leaves_at
            rows.append(
                {
                    **emp,
                    "Month": month.isoformat(),
                    "EndingHeadcount": 1 if active else 0,
                    "Exits": 1 if exited else 0,
                    "NewHires": 1 if i == joined_at else 0,
                    "TenureYears": round(tenure_start + i / 12.0, 2) if active else "",
                }
            )

FIELDS = [
    "EmployeeId", "EmployeeName", "Department", "Location", "EmploymentType",
    "Gender", "Band", "Designation", "L1Manager", "DateOfJoining", "Month",
    "EndingHeadcount", "Exits", "NewHires", "TenureYears",
]

csv_path = os.path.join(OUT, "sample-hr-data.csv")
with open(csv_path, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=FIELDS)
    w.writeheader()
    w.writerows(rows)

# the same rows as a Power Query literal, so the sample .pbix has no file path in it
with open(csv_path) as f:
    body = f.read()

m_path = os.path.join(OUT, "sample-data-query.m")
escaped = body.replace('"', '""')
with open(m_path, "w") as f:
    f.write(
        "// Paste into Power BI Desktop: Home -> Transform data -> New Source -> Blank Query\n"
        "// -> Advanced Editor -> replace everything with this -> Done -> Close & Apply.\n"
        "//\n"
        "// The rows are embedded in the query itself, so the resulting .pbix holds no file\n"
        "// path and makes no connection to anything - which is what the AppSource sample\n"
        "// report has to be able to do.\n"
        "let\n"
        '    Source = Csv.Document("' + escaped + '", [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),\n'
        "    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),\n"
        "    Typed = Table.TransformColumnTypes(Promoted, {\n"
        '        {"EmployeeId", type text}, {"EmployeeName", type text}, {"Department", type text},\n'
        '        {"Location", type text}, {"EmploymentType", type text}, {"Gender", type text},\n'
        '        {"Band", type text}, {"Designation", type text}, {"L1Manager", type text},\n'
        '        {"DateOfJoining", type date}, {"Month", type date},\n'
        '        {"EndingHeadcount", Int64.Type}, {"Exits", Int64.Type}, {"NewHires", Int64.Type},\n'
        '        {"TenureYears", type number}\n'
        "    })\n"
        "in\n"
        "    Typed\n"
    )

print(f"{csv_path}: {len(rows)} rows, {os.path.getsize(csv_path)/1024:.0f} KB")
print(f"{m_path}: {os.path.getsize(m_path)/1024:.0f} KB")
print(f"employees: {emp_no - 1000}, months: {len(MONTHS)}")
