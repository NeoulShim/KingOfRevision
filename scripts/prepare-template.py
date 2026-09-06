from zipfile import ZipFile
from pathlib import Path
import json, re
base = Path(__file__).resolve().parent.parent
with ZipFile(base / 'assets/template.hwpx') as z:
    data = {n: z.read(n).decode('utf-8') for n in z.namelist() if n != 'Preview/PrvImage.png'}
data['Contents/header.xml'] = re.sub(r'(<hh:font\b[^>]*?face=")[^"]*', r'\1함초롬바탕', data['Contents/header.xml'])
data['Contents/header.xml'] = re.sub(r'(<hh:charPr\b[^>]*?height=")[^"]*', r'\g<1>1100', data['Contents/header.xml'])
data['Contents/content.hpf'] = re.sub(r'<opf:metadata>.*?</opf:metadata>', '<opf:metadata><opf:title/><opf:language>ko</opf:language></opf:metadata>', data['Contents/content.hpf'])
data['Preview/PrvText.txt'] = ''
out = base / 'src/core/template.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Prepared clean HWPX template:', len(out.read_bytes()), 'bytes')
