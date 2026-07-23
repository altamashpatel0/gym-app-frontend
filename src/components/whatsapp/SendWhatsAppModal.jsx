import { useEffect, useState } from "react";
import { MessageCircle, ChevronLeft, Send } from "lucide-react";
import { Modal, Button, FormField } from "../ui/index";
import {
  LANGUAGE_OPTS,
  generateMessage,
  buildWhatsAppUrl,
  loadSavedGymName,
  saveGymName,
} from "../../utils/whatsapp";

/**
 * Two-step modal:
 *  1. Pick language + gym name → "Generate Messages"
 *  2. Editable per-member preview → owner clicks "Open WhatsApp" for each
 *     member individually (wa.me only ever opens one chat at a time, and the
 *     owner must manually press Send inside WhatsApp — nothing here sends
 *     anything automatically).
 */
export function SendWhatsAppModal({ open, onClose, members }) {
  const [step, setStep] = useState("setup"); // "setup" | "preview"
  const [language, setLanguage] = useState("en");
  const [gymName, setGymName] = useState("");
  const [messages, setMessages] = useState({}); // { [memberId]: text }
  const [sentIds, setSentIds] = useState({}); // { [memberId]: true } once "Open WhatsApp" was clicked

  useEffect(() => {
    if (open) {
      setStep("setup");
      setLanguage("en");
      setGymName(loadSavedGymName());
      setSentIds({});
    }
  }, [open]);

  const handleGenerate = () => {
    saveGymName(gymName);
    const next = {};
    members.forEach((m) => {
      next[m.id] = generateMessage({ member: m, language, gymName });
    });
    setMessages(next);
    setStep("preview");
  };

  const handleMessageChange = (memberId, value) => {
    setMessages((prev) => ({ ...prev, [memberId]: value }));
  };

  const handleOpenWhatsApp = (member) => {
    const url = buildWhatsAppUrl(member.phone, messages[member.id] || "");
    window.open(url, "_blank", "noopener,noreferrer");
    setSentIds((prev) => ({ ...prev, [member.id]: true }));
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={step === "setup" ? "Send WhatsApp Reminders" : "Preview & Send"}
      width="max-w-2xl"
    >
      {step === "setup" && (
        <div className="space-y-5">
          <p className="text-sm text-gray-400">
            {members.length} member{members.length !== 1 ? "s" : ""} selected. Choose a language and the
            message will be generated automatically for each member.
          </p>

          <FormField label="Gym Name (used in the message)">
            <input
              type="text"
              className="input"
              placeholder="e.g. FitZone Gym"
              value={gymName}
              onChange={(e) => setGymName(e.target.value)}
            />
          </FormField>

          <FormField label="Language">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {LANGUAGE_OPTS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                    language === opt.value
                      ? "bg-brand-500/15 border-brand-500/40 text-brand-400"
                      : "bg-surface-muted border-surface-border text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="whatsapp-language"
                    className="accent-brand-500"
                    checked={language === opt.value}
                    onChange={() => setLanguage(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </FormField>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleGenerate} disabled={members.length === 0}>
              Generate Messages
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <button
            onClick={() => setStep("setup")}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <ChevronLeft size={14} /> Back
          </button>

          <p className="text-xs text-gray-500">
            Review and edit each message before opening WhatsApp. Nothing is sent automatically — you
            press Send inside WhatsApp yourself.
          </p>

          <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
            {members.map((m) => (
              <div key={m.id} className="bg-surface-muted border border-surface-border rounded-lg p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-100 truncate">{m.name}</p>
                    <p className="text-xs text-gray-500">{m.phone || "No phone"}</p>
                  </div>
                  {sentIds[m.id] && (
                    <span className="text-xs text-green-400 font-medium shrink-0">Opened ✓</span>
                  )}
                </div>
                <textarea
                  className="input min-h-[140px] font-mono text-xs leading-relaxed"
                  value={messages[m.id] || ""}
                  onChange={(e) => handleMessageChange(m.id, e.target.value)}
                />
                <div className="flex justify-end mt-2">
                  <Button
                    className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700"
                    onClick={() => handleOpenWhatsApp(m)}
                    disabled={!m.phone}
                  >
                    <MessageCircle size={13} /> Open WhatsApp
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={handleClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default SendWhatsAppModal;
