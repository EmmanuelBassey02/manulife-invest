import { api } from '../api.js';
import { esc, icon, bindForm, field, check, toast, modal } from '../ui.js';
import { state, navigate, refreshUser, logout } from '../app.js';

const COUNTRIES = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'United Kingdom', 'United States', 'Canada', 'United Arab Emirates', 'Germany', 'France', 'Netherlands', 'Ireland', 'Côte d’Ivoire', 'Senegal', 'Cameroon', 'Rwanda', 'Uganda', 'Tanzania', 'Egypt', 'Morocco', 'India', 'Singapore', 'Australia', 'Other'];
export { COUNTRIES };

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : null);
const after = (u, next) => {
  if (u.role === 'admin' || u.role === 'super_admin') return safeNext(next)?.startsWith('/admin') ? next : '/admin';
  return safeNext(next) || '/app';
};

const pwToggle = `<button type="button" class="pw-toggle" data-pw aria-label="Show password">${icon('eye')}</button>`;
function bindPw(root) {
  root.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', () => {
    const input = b.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }));
}

export async function login(ctx) {
  return {
    title: 'Sign in',
    html: `<p class="auth__top">New to Manulife? <a href="/register${ctx.query.next ? `?next=${encodeURIComponent(ctx.query.next)}` : ''}">Create account ${icon('arrow')}</a></p><div class="auth__card"><span class="auth__rule"></span><h1>Welcome back</h1><p class="muted">Sign in to your investor or admin account.</p>
    <form class="form" data-f novalidate>
      ${field({ name: 'email', label: 'Email address', type: 'email', required: true, ico: 'mail', placeholder: 'you@example.com', attrs: 'autocomplete="email" autofocus' })}
      <div class="field"><label for="pw">Password</label><div class="pw inp"><span class="inp__ico">${icon('lock')}</span><input id="pw" name="password" type="password" required autocomplete="current-password" maxlength="128" placeholder="Enter your password">${pwToggle}</div><p class="field__error" hidden></p></div>
      <p class="form__aside"><a href="/forgot-password">Forgot password?</a></p>
      <p class="form-error" hidden></p>
      <button class="btn btn--gold btn--block btn--lg" type="submit">Sign in ${icon('arrow')}</button>
    </form>
    <p class="auth__note"><span>${icon('shield')}</span>Your information is secure and will only be used for account verification and investment purposes.</p></div>`,
    mount(root) {
      bindPw(root);
      const pre = JSON.parse(sessionStorage.getItem('ei_prefill') || 'null');
      sessionStorage.removeItem('ei_prefill');
      if (pre) {
        root.querySelector('[name=email]').value = pre.email;
        root.querySelector('[name=password]').value = pre.password;
      }
      bindForm(root.querySelector('[data-f]'), async (d) => {
        const { user } = await api.post('/api/auth/login', d);
        state.user = user;
        toast(`Welcome back, ${user.first_name}.`);
        navigate(after(user, ctx.query.next), { replace: true });
      });
    },
  };
}

export async function register(ctx) {
  return {
    title: 'Create account',
    html: `<p class="auth__top">Already have an account? <a href="/login${ctx.query.next ? `?next=${encodeURIComponent(ctx.query.next)}` : ''}">Sign in ${icon('arrow')}</a></p><div class="auth__card auth__card--wide"><span class="auth__rule"></span><h1>Create your account</h1><p class="muted">It takes about two minutes. You’ll verify your identity before investing.</p>
    <form class="form" data-f novalidate><div class="form-grid">
      ${field({ name: 'first_name', label: 'First name', required: true, ico: 'user', placeholder: 'John', attrs: 'autocomplete="given-name" maxlength="60"' })}
      ${field({ name: 'last_name', label: 'Last name', required: true, ico: 'user', placeholder: 'Doe', attrs: 'autocomplete="family-name" maxlength="60"' })}
      ${field({ name: 'email', label: 'Email address', type: 'email', required: true, ico: 'mail', placeholder: 'you@example.com', attrs: 'autocomplete="email"' })}
      ${field({ name: 'phone', label: 'Phone number', type: 'tel', required: true, ico: 'phone', placeholder: '+234 800 800 0000', attrs: 'autocomplete="tel" inputmode="tel" minlength="7" maxlength="30"' })}
      ${field({ name: 'country', label: 'Country of residence', required: true, ico: 'globe', options: [['', 'Select your country'], ...COUNTRIES.map((c) => [c, c])] })}
      <div class="field"><label for="rpw">Password</label><div class="pw inp"><span class="inp__ico">${icon('lock')}</span><input id="rpw" name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password" placeholder="Create a strong password">${pwToggle}</div><p class="field__hint">At least 8 characters, with letters and numbers.</p><p class="field__error" hidden></p></div>
    </div>
    <fieldset class="consents"><legend class="sr-only">Agreements</legend>
      ${check({ name: 'accept_terms', required: true, html: true, label: 'I accept the <a href="/legal/terms" target="_blank">Terms &amp; Conditions</a>' })}
      ${check({ name: 'accept_privacy', required: true, html: true, label: 'I accept the <a href="/legal/privacy" target="_blank">Privacy Policy</a>' })}
      ${check({ name: 'accept_risk', required: true, html: true, label: 'I have read the <a href="/legal/risk" target="_blank">Risk Disclosure</a> and understand my capital is at risk' })}
    </fieldset>
    <p class="form-error" hidden></p>
    <button class="btn btn--gold btn--block btn--lg" type="submit">Create account ${icon('arrow')}</button></form>
    <p class="auth__note"><span>${icon('shield')}</span>Your information is secure and will only be used for account verification and investment purposes.</p></div>`,
    mount(root) {
      bindPw(root);
      bindForm(root.querySelector('[data-f]'), async (d) => {
        await api.post('/api/auth/register', d);
        const go = () => {
          sessionStorage.setItem('ei_prefill', JSON.stringify({ email: d.email, password: d.password }));
          navigate(`/login${ctx.query.next ? `?next=${encodeURIComponent(ctx.query.next)}` : ''}`, { replace: true });
        };
        let done = false;
        const proceed = () => { if (!done) { done = true; go(); } };
        modal({
          title: 'Account created',
          body: `<div class="center"><span class="big-ico big-ico--ok">${icon('check')}</span><p>Your account has been created successfully. Continue to sign in.</p></div>`,
          actions: '<button class="btn btn--gold" type="button" data-close>Continue to sign in</button>',
          onClose: proceed,
        });
      });
    },
  };
}

export async function verifyPending() {
  const u = state.user;
  if (u.email_verified) {
    const next = sessionStorage.getItem('ei_next');
    sessionStorage.removeItem('ei_next');
    setTimeout(() => navigate(after(u, next), { replace: true }), 0);
    return { title: 'Verified', html: '' };
  }
  return {
    title: 'Verify your email',
    html: `<div class="auth__card center"><span class="big-ico">${icon('mail')}</span><h1>Check your inbox</h1>
      <p class="muted">We sent a verification link to <strong>${esc(u.email)}</strong>. Open it to activate your account. The link expires in 48 hours.</p>
      <div class="stack"><button class="btn btn--gold btn--block" data-resend>Resend verification email</button><button class="btn btn--ghost btn--block" data-check>I’ve verified my email</button><button class="btn btn--link" data-out>Sign out</button></div></div>`,
    mount(root) {
      root.querySelector('[data-resend]').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try { await api.post('/api/auth/resend-verification'); toast('Verification email sent.'); }
        catch (err) { toast(err.message, 'bad'); }
        finally { setTimeout(() => { e.target.disabled = false; }, 15000); }
      });
      root.querySelector('[data-check]').addEventListener('click', async () => {
        const fresh = await refreshUser();
        if (fresh?.email_verified) navigate(after(fresh, sessionStorage.getItem('ei_next')), { replace: true });
        else toast('Your email is not verified yet. Open the link in the email we sent.', 'bad');
      });
      root.querySelector('[data-out]').addEventListener('click', logout);
    },
  };
}

export async function verifyEmail(ctx) {
  let ok = false;
  let msg = '';
  try { await api.post('/api/auth/verify-email', { token: ctx.query.token || '' }); ok = true; await refreshUser(); }
  catch (e) { msg = e.message; }
  const next = state.user ? after(state.user, sessionStorage.getItem('ei_next')) : '/login';
  return {
    title: ok ? 'Email verified' : 'Verification failed',
    html: `<div class="auth__card center"><span class="big-ico ${ok ? 'big-ico--ok' : 'big-ico--bad'}">${icon(ok ? 'check' : 'alert')}</span>
      <h1>${ok ? 'Email verified' : 'Link not valid'}</h1><p class="muted">${ok ? 'Your email address is confirmed. Next, verify your identity so you can invest.' : esc(msg)}</p>
      <a class="btn btn--gold btn--block" href="${ok ? (state.user ? '/app/kyc' : '/login') : next}">${ok ? (state.user ? 'Start identity verification' : 'Sign in') : 'Continue'}</a></div>`,
  };
}

export async function forgot() {
  return {
    title: 'Reset password',
    html: `<div class="auth__card"><h1>Reset your password</h1><p class="muted">Enter your account email and we’ll send a reset link.</p>
    <form class="form" data-f novalidate>${field({ name: 'email', label: 'Email', type: 'email', required: true, attrs: 'autocomplete="email"' })}<p class="form-error" hidden></p>
    <button class="btn btn--gold btn--block btn--lg" type="submit">Send reset link</button></form><p class="auth__switch"><a href="/login">Back to sign in</a></p></div>`,
    mount(root) {
      const form = root.querySelector('[data-f]');
      bindForm(form, async (d) => {
        await api.post('/api/auth/forgot-password', d);
        form.innerHTML = `<div class="callout">${icon('mail')}<div><strong>Check your email</strong><p>If an account exists for ${esc(d.email)}, a reset link is on its way. It expires in 1 hour.</p></div></div>`;
      });
    },
  };
}

export async function reset(ctx) {
  return {
    title: 'Choose a new password',
    html: `<div class="auth__card"><h1>Choose a new password</h1><p class="muted">You’ll be signed out of all devices after the change.</p>
    <form class="form" data-f novalidate><input type="hidden" name="token" value="${esc(ctx.query.token || '')}">
    <div class="field"><label for="npw">New password</label><div class="pw"><input id="npw" name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password">${pwToggle}</div><p class="field__hint">At least 8 characters, with letters and numbers.</p><p class="field__error" hidden></p></div>
    <p class="form-error" hidden></p><button class="btn btn--gold btn--block btn--lg" type="submit">Save new password</button></form></div>`,
    mount(root) {
      bindPw(root);
      bindForm(root.querySelector('[data-f]'), async (d) => {
        await api.post('/api/auth/reset-password', d);
        state.user = null;
        toast('Password updated. Sign in with your new password.');
        navigate('/login', { replace: true });
      });
    },
  };
}
