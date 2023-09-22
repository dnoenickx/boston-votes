import json
from tqdm import tqdm
from collections import defaultdict
import re
import hashlib
import numpy as np
from camelot import read_pdf
from requests import get
from urllib.parse import urljoin
from bs4 import BeautifulSoup
import pandas as pd
import os
import pickle
from datetime import datetime

BASE_URL = "https://www.boston.gov"
RESULTS_PATH = "/departments/elections/state-and-city-boston-election-results"

INCLUDE_DRAWERS = ["september 25, 2007"]

SKIP_FILES = [
    "/At%20Large%20City%20Councillor%20Ward%20Results_tcm3-26258.pdf",
    "/2015%20-%2009-08-15%20-%20Preliminary%20Municipal%20Election%20-%20Ballost%20Cast%20-%20CCD4%20and%20CCD7_tcm3-52074.pdf",
    "/2013%20-%2011-05-13%20-%20Casino%20Question%20Ward%20%26%20Precinct%20Results_tcm3-41960.pdf",
]


MARK_PRELIMINARY = ["2007-09-25"]

SPECIFY_DESTRICT = {
    (
        "october 19, 2010: special preliminary municipal election",
        "ward and precinct official results",
    ): 6,
    (
        "may 15, 2007: special municipal election",
        "election results",
    ): 2,
    (
        "april 17, 2007: special preliminary municipal election",
        "election results",
    ): 2,
    (
        "may 16, 2006: special preliminary municipal election",
        "election results",
    ): 1,
}

DROP_ONE = ["/d9%209-27-05_tcm3-26275.pdf"]

DROP_THREE = [
    "/at%20large%209-27-05_tcm3-26274.pdf",
    "/d9_tcm3-26270.pdf",
    "/d8_tcm3-26269.pdf",
    "/d7_tcm3-26268.pdf",
    "/d5_tcm3-26266.pdf",
    "/d4_tcm3-26265.pdf",
    "/d3_tcm3-26264.pdf",
    "/d2_tcm3-26263.pdf",
    "/d1_tcm3-26262.pdf",
    "/at%20large_tcm3-26272.pdf",
    "/Mayor%20ward%20precinct_tcm3-26271.pdf",
    "/d6_tcm3-26267.pdf",
]

assert all(one not in DROP_THREE for one in DROP_ONE)


def cache_result(func):
    def wrapper(*args, **kwargs):
        cache_key = hashlib.md5(
            (func.__name__ + str(args) + str(kwargs)).encode()
        ).hexdigest()

        cache_directory = "python/cache"
        cache_file = os.path.join(cache_directory, cache_key + ".pkl")

        if os.path.exists(cache_file):
            with open(cache_file, "rb") as file:
                cached_result = pickle.load(file)
            return cached_result
        else:
            result = func(*args, **kwargs)
            os.makedirs(cache_directory, exist_ok=True)
            with open(cache_file, "wb") as file:
                pickle.dump(result, file)
            return result

    return wrapper


@cache_result
def scrape_races():
    """
    Scrape links to results for municipal elections.

    :return: A tuple containing the header for the election, the text of the results link,
        and the link to the results PDF
    :rtype: List[Tuple[str, str, str]]
    """

    election_results_url = urljoin(BASE_URL, RESULTS_PATH)
    res = get(election_results_url)

    soup = BeautifulSoup(res.content, "html.parser")

    elections = []
    for drawer_div in soup.select('div[bos_context_type="Drawer"]'):
        drawer_title = drawer_div.select("div.dr-t")[0].find("div").text.strip().lower()

        # Skip non-municipal elections & include any poorly labeled elections
        if "municipal" not in drawer_title and drawer_title not in INCLUDE_DRAWERS:
            continue

        def is_muni_link(text):
            return any(q in text.lower() for q in ["council", "mayor", "result"])

        muni_links = drawer_div.select("div.dr-c")[0].find_all("a", string=is_muni_link)

        for link in muni_links:
            file_url = urljoin(BASE_URL, link["href"])  # add domain to relative urls
            if any(file_url.endswith(skip) for skip in SKIP_FILES):
                continue
            replacement = ("http://documents.boston.gov/", "https://www.cityofboston.gov/")
            file_url = file_url.replace(*replacement)
            link_text = link.text.replace("\xa0", " ").lower()
            elections.append((drawer_title, link_text, file_url))
    return elections


def clean_df(df):
    """
    Performs basic cleaning of election result dataframes.

    :return: DataFrame of cleaned results.
    :rtype: DataFrame
    """
    # use first row as header
    df.columns = df.iloc[0]
    df = df.drop(0)

    df.columns = df.columns.str.replace("CANDIDATES", "candidate")

    # drops precints without votes (not in this district)
    df = df[df.columns[df.iloc[0] != ""]]

    # drop total column
    df = df.drop("TOTAL", axis=1)

    # drop empty rows
    df["candidate"] = df["candidate"].replace("", np.nan)
    df = df.dropna(subset=["candidate"])

    # clean write in candidates
    def _clean_write_in(candidate):
        write_in = "(WRITE-IN)"
        for indx in range(1, len(write_in)):
            if candidate.endswith(write_in[0:indx]):
                return candidate + write_in[indx:]
        return candidate

    df["candidate"] = df["candidate"].apply(_clean_write_in)

    df = pd.melt(df, id_vars="candidate", var_name="precinct", value_name="votes")

    # fix camelot's merging of some cells
    for field in ["BLANKS", "VOTES CAST", "BALLOTS CAST", "ALL OTHERS"]:
        field_df = df[df.candidate == field]
        if any(field_df.votes.apply(lambda val: val == "")):
            correct_values = list(map(int, " ".join(field_df.votes).split()))
            df.loc[field_df.index, "votes"] = correct_values

    return df


def get_district(election_title, link_text):
    if (election_title, link_text) in SPECIFY_DESTRICT:
        return SPECIFY_DESTRICT[(election_title, link_text)]
    search_text = election_title + link_text
    if "mayor" in search_text:
        return "mayor"
    elif "large" in search_text:
        return "at_large"
    # 'NoneType' object has no attribute 'group'? Add to SPECIFY_DESTRICT
    return int(re.search(r"district (\d+)", search_text.lower()).group(1))


def get_election_details(election_title, link_text):
    search_text = election_title + link_text
    date = datetime.strptime(election_title.split(":")[0], "%B %d, %Y").strftime("%Y-%m-%d")
    preliminary = "prelim" in search_text or date in MARK_PRELIMINARY
    special = "special" in search_text
    return date, preliminary, special


def download_url_with_certificate(url, cert_file_path):
    """Download file from specified URL using a certificate.

    Parameters
    ----------
    url : str or unicode
        The URL to download the file from.
    cert_file_path : str or unicode
        The file path to the certificate file (in .cer format).

    Returns
    -------
    filepath : str or unicode
        Temporary filepath.

    """
    import shutil
    import tempfile
    from urllib.request import Request, urlopen
    from camelot.utils import random_string
    import ssl

    filename = f"{random_string(6)}.pdf"
    with tempfile.NamedTemporaryFile("wb", delete=False) as f:
        headers = {"User-Agent": "Mozilla/5.0"}
        request = Request(url, None, headers)

        # Create an SSL context and load the certificate
        ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS)
        ssl_context.load_verify_locations(cafile=cert_file_path)

        obj = urlopen(request, context=ssl_context)
        content_type = obj.info().get_content_type()
        if content_type != "application/pdf":
            raise NotImplementedError("File format not supported")

        f.write(obj.read())

    filepath = os.path.join(os.path.dirname(f.name), filename)
    shutil.move(f.name, filepath)
    return filepath


@cache_result
def get_ward_dfs(url):
    try:
        all_tables = read_pdf(url, "all")
    except:
        filepath = download_url_with_certificate(url, "_.cityofboston.gov.cer")
        all_tables = read_pdf(filepath, "all")

    if any(url.endswith(drop) for drop in DROP_THREE):
        all_tables = all_tables[:-3]
    elif any(url.endswith(drop) for drop in DROP_ONE):
        all_tables = all_tables[:-1]

    # Exclude every other table, so as to get raw counts, as opposed to percents
    summary_df, *ward_dfs = [all_tables[i].df for i in range(0, len(all_tables), 2)]
    # Get ward numbers from the ward-level (first) table
    wards = list(map(int, summary_df.iloc[0][1:-1]))

    return wards, [clean_df(df) for df in ward_dfs]


def _get_candidate_list(precint_df):
    ballots_cast, blanks, all_others, candidates_list = None, None, None, []
    for _, row in precint_df.iterrows():
        candidate, votes = row["candidate"], int(row["votes"])
        if candidate == "BALLOTS CAST":
            ballots_cast = votes
        elif candidate == "VOTES CAST":
            votes_cast = votes
        elif candidate == "BLANKS":
            blanks = votes
        elif candidate == "ALL OTHERS":
            all_others = votes
        else:
            candidate_dict = {"name": candidate, "votes": votes}
            candidates_list.append(candidate_dict)
    candidates_list.sort(key=lambda c: c["name"])
    assert all(val is not None for val in [ballots_cast, votes_cast, blanks, all_others])
    return ballots_cast, votes_cast, blanks, all_others, candidates_list


def get_results(wards, ward_dfs):
    results = []
    for ward, ward_df in zip(wards, ward_dfs):
        for precinct, precint_df in ward_df.groupby("precinct"):
            try:
                precinct = int(precinct)
            except:
                precinct = str(precinct)
            *details, candidates_list = _get_candidate_list(precint_df)
            ballots_cast, votes_cast, blanks, all_others = details
            assert votes_cast == sum(c["votes"] for c in candidates_list) + all_others
            # assert ballots_cast == votes_cast + blanks Data is wrong here...
            results.append(
                {
                    "ward": ward,
                    "precinct": precinct,
                    "ballots_cast": votes_cast + blanks,  # TODO data is sometimes wrong
                    "votes_cast": votes_cast,
                    "blanks": blanks,
                    "all_others": all_others,
                    "candidates": candidates_list,
                }
            )
    names_lists = [[cand["name"] for cand in race["candidates"]] for race in results]
    assert all(names == names_lists[0] for names in names_lists)

    def _sort_ward_precinct(row):
        return row["ward"], int(re.sub(r"[^0-9]", "", str(row["precinct"])))

    return sorted(results, key=_sort_ward_precinct)


def get_geometry():
    return ""


def get_election_title(date, preliminary, special, races):
    year = datetime.strptime(date, "%Y-%m-%d").strftime("%Y")
    if not special:
        return f"{year} {'Preliminary' if preliminary else 'General'} Election"
    else:
        assert len(races) == 1
        district = races[0]["district"]
        if district == "mayor":
            return f"{year} Special Mayoral Election{' Primary' if preliminary else ''}"
        elif district == "at_large":
            return f"{year} At-Large Special Election{' Primary' if preliminary else ''}"
        else:
            return f"{year} Special Election{' Primary' if preliminary else ''} (District {district})"


def sort_races(races):
    district = races["district"]
    if district == "mayor":
        return (0, district)
    elif district == "at_large":
        return (1, district)
    assert type(district) is int
    return (2, district)


def to_election(date, preliminary, special, races):
    return {
        "date": date,
        "title": get_election_title(date, preliminary, special, races),
        "geometry": get_geometry(),
        "special": special,
        "preliminary": preliminary,
        "races": sorted(races, key=sort_races),
    }


def get_elections():
    election_to_races = defaultdict(list)
    for election_title, link_text, file_url in tqdm(scrape_races(), unit="races"):
        details = get_election_details(election_title, link_text)

        results = get_results(*get_ward_dfs(file_url))

        election_to_races[details].append(
            {
                "district": get_district(election_title, link_text),
                "url": file_url,
                "results": results,
            }
        )
    elections = [
        to_election(*details, races) for details, races in election_to_races.items()
    ]
    elections.sort(key=lambda e: e["date"], reverse=True)
    return elections


elections = get_elections()

with open("data/all_elections.json", "w") as json_file:
    json.dump(elections, json_file)


list_elections = []
for election in elections:
    races = []
    for race in election["races"]:
        if type(race["district"]) is int:
            title = f"District {race['district']}"
        else:
            title = race["district"].replace("_", " ").title()
        races.append({"district": race["district"], "title": title})
    list_elections.append(
        {
            "date": election["date"],
            "title": election["title"],
            "geometry": '/data/2012_precincts.geojson', # election["geometry"],
            "races": races,
        }
    )
with open("data/list_elections.json", "w") as f:
    json.dump(list_elections, f)


for election in elections:
    for race in election["races"]:
        cand_votes = defaultdict(int)
        ballots_cast = 0
        for precinct in race["results"]:
            ballots_cast += precinct["ballots_cast"]
            for cand in precinct["candidates"]:
                cand_votes[cand["name"]] += cand["votes"]
        summary = [
            {
                "name": name.title(),
                "votes": votes,
                "percent": round(votes / ballots_cast * 100, 2)
            }
            for name, votes in cand_votes.items()
        ]

        summary.sort(key=lambda x: x["votes"], reverse=True)

        cand_order = [s["name"] for s in summary]
        
        precincts = []
        for precinct in race["results"]:
            candidates = []
            for cand in precinct["candidates"]:
                candidates.append({
                    "name": cand["name"].title(),
                    "votes": cand["votes"],
                    "percent": round(cand["votes"] / precinct["ballots_cast"] * 100, 2) if precinct["ballots_cast"] else 0,
                })
            candidates.sort(key=lambda x: cand_order.index(x["name"]))
            precincts.append({
                "ward": precinct["ward"],
                "precinct": precinct["precinct"],
                "votes_cast": precinct["votes_cast"],
                "candidates": candidates
            })

        with open(f"data/{election['date']}-{race['district']}.json", "w") as f:
            json.dump({"summary": summary, "precincts": precincts}, f)
