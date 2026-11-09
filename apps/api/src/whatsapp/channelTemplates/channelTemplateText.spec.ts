import {
  findInvalidPlaceholders,
  renderEmailHtml,
  renderEmailText,
} from './channelTemplateText';

describe('findInvalidPlaceholders', () => {
  it('accepts placeholders within the parameter count, repeated or skipped', () => {
    expect(findInvalidPlaceholders('{{1}} y {{3}}, otra vez {{1}}', 3)).toEqual(
      [],
    );
    expect(findInvalidPlaceholders('Sin marcadores', 0)).toEqual([]);
  });

  it('rejects a number beyond the parameter count, or zero', () => {
    expect(findInvalidPlaceholders('{{1}} {{4}}', 3)).toEqual(['{{4}}']);
    expect(findInvalidPlaceholders('{{0}}', 3)).toEqual(['{{0}}']);
  });

  it('rejects malformed placeholders', () => {
    expect(findInvalidPlaceholders('{{ 1 }}', 3)).toEqual(['{{ 1 }}']);
    expect(findInvalidPlaceholders('{{nombre}}', 3)).toEqual(['{{nombre}}']);
    expect(findInvalidPlaceholders('valor {{2', 3)).toEqual(['{{2']);
    expect(findInvalidPlaceholders('valor 2}}', 3)).toEqual(['}}']);
  });
});

describe('renderEmailHtml', () => {
  it('turns blank lines into paragraphs, line breaks into <br> and *x* into bold', () => {
    const html = renderEmailHtml('Hola *Juana*.\n\nLínea 1\nLínea 2');
    expect(html).toContain(
      '<p style="margin:0 0 16px">Hola <strong>Juana</strong>.</p>',
    );
    expect(html).toContain('<p style="margin:0 0 16px">Línea 1<br>Línea 2</p>');
  });

  it('escapes HTML coming from the template or a parameter', () => {
    const html = renderEmailHtml('Producto: <script>alert("x")</script> & co');
    expect(html).toContain(
      'Producto: &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co',
    );
    expect(html).not.toContain('<script>');
  });

  it('does not bold across lines', () => {
    expect(renderEmailHtml('*uno\ndos*')).not.toContain('<strong>');
  });
});

describe('renderEmailText', () => {
  it('drops the bold markers', () => {
    expect(renderEmailText('  Pague *hoy* $1.000 \n')).toBe('Pague hoy $1.000');
  });
});
