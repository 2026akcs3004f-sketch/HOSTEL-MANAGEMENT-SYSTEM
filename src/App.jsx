import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "./utils/supabase";

const FILE_BUCKET = "student-documents";
const LEGACY_KEYS = ["students", "rooms", "allocations", "payments"];

const styles = {
  auth: {
    width: "100%",
    minHeight: "100vh",
    margin: "0",
    padding: "7vh 20px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    fontFamily: "Inter, Arial, sans-serif",
    color: "#fff",
    background: "linear-gradient(135deg, rgba(20, 43, 35, .86), rgba(33, 75, 59, .52)), url(https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1800&q=85) center/cover",
  },
  form: {
    display: "grid",
    gap: "12px",
    marginBottom: "16px",
  },
  error: { color: "#b00020" },
  success: { color: "#176b2c" },
};

function readLegacyData() {
  return Object.fromEntries(
    LEGACY_KEYS.map((key) => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "[]");
        return [key, Array.isArray(value) ? value : []];
      } catch {
        return [key, []];
      }
    }),
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupReg, setSignupReg] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [registrationName, setRegistrationName] = useState("");
  const [registrationReg, setRegistrationReg] = useState("");
  const [registrationPhone, setRegistrationPhone] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [page, setPage] = useState("Dashboard");
  const [roomNumber, setRoomNumber] = useState("");
  const [roomCapacity, setRoomCapacity] = useState("");
  const [studentPaymentAmount, setStudentPaymentAmount] = useState("");
  const [studentPaymentMethod, setStudentPaymentMethod] = useState("M-Pesa");
  const [studentPaymentReference, setStudentPaymentReference] = useState("");
  const [fileStudent, setFileStudent] = useState("");

  const [students, setStudents] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [files, setFiles] = useState([]);
  const [roomApplications, setRoomApplications] = useState([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) return undefined;

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError) setError(sessionError.message);
        setUser(data.session?.user ?? null);
        setAuthReady(true);
      })
      .catch((sessionError) => {
        if (!active) return;
        setError(sessionError.message || "Could not load your session.");
        setAuthReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  async function migrateLegacyDataIfNeeded() {
    const tables = ["students", "rooms", "allocations", "payments"];

    const counts = await Promise.all(
      tables.map((table) =>
        supabase.from(table).select("*", { count: "exact", head: true }),
      ),
    );

    counts.forEach(({ error: queryError }) => {
      if (queryError) throw queryError;
    });

    if (counts.some(({ count }) => count > 0)) return;

    const legacy = readLegacyData();

    const oldStudents = legacy.students
      .filter((student) => student.reg && student.name)
      .map((student) => ({
        reg: String(student.reg),
        name: String(student.name),
        phone: String(student.phone || ""),
      }));

    const oldRooms = legacy.rooms
      .filter((room) => room.roomNumber)
      .map((room) => ({
        room_number: String(room.roomNumber),
        capacity: Number(room.roomCapacity),
      }))
      .filter((room) => Number.isInteger(room.capacity) && room.capacity > 0);

    if (oldStudents.length) {
      const { error: insertError } = await supabase
        .from("students")
        .upsert(oldStudents, { onConflict: "user_id,reg" });
      if (insertError) throw insertError;
    }

    if (oldRooms.length) {
      const { error: insertError } = await supabase
        .from("rooms")
        .upsert(oldRooms, { onConflict: "user_id,room_number" });
      if (insertError) throw insertError;
    }

    const studentRegs = new Set(oldStudents.map((student) => student.reg));
    const roomNumbers = new Set(oldRooms.map((room) => room.room_number));

    const oldAllocations = legacy.allocations
      .filter(
        (item) =>
          studentRegs.has(String(item.student)) &&
          roomNumbers.has(String(item.room)),
      )
      .map((item) => ({
        student_reg: String(item.student),
        room_number: String(item.room),
      }));

    if (oldAllocations.length) {
      const { error: insertError } = await supabase
        .from("allocations")
        .upsert(oldAllocations, { onConflict: "user_id,student_reg" });
      if (insertError) throw insertError;
    }

    const oldPayments = legacy.payments
      .filter((item) => studentRegs.has(String(item.student)))
      .map((item) => ({
        legacy_id: String(item.id ?? crypto.randomUUID()),
        student_reg: String(item.student),
        amount: Number(item.amount),
        method: String(item.method || "Cash"),
        status: ["Paid", "Pending"].includes(item.status)
          ? item.status
          : "Pending",
        paid_on: /^\d{4}-\d{2}-\d{2}$/.test(item.date || "")
          ? item.date
          : new Date().toISOString().slice(0, 10),
      }))
      .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

    if (oldPayments.length) {
      const { error: insertError } = await supabase
        .from("payments")
        .upsert(oldPayments, { onConflict: "user_id,legacy_id" });
      if (insertError) throw insertError;
    }

    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));

    if (
      oldStudents.length ||
      oldRooms.length ||
      oldAllocations.length ||
      oldPayments.length
    ) {
      setMessage("Your existing browser data was copied to your Supabase account.");
    }
  }

  async function loadData() {
    if (!user || !supabase) return;

    setLoading(true);
    setError("");

    try {
      const { data: profileData, error: profileError } = await supabase
        .from("user_profiles")
        .select("role,owner_user_id,student_reg")
        .maybeSingle();

      if (profileError) throw profileError;

      const activeProfile = profileData || { role: "student", owner_user_id: null, student_reg: null };

      setProfile(activeProfile);

      if (activeProfile.role === "admin") {
        await migrateLegacyDataIfNeeded();
      }

      const [
        studentResult,
        roomResult,
        allocationResult,
        paymentResult,
        applicationResult,
      ] = await Promise.all([
        supabase.from("students").select("reg,name,phone,auth_user_id,verification_status").order("created_at"),
        supabase.rpc("get_available_rooms"),
        supabase
          .from("allocations")
          .select("student_reg,room_number")
          .order("created_at"),
        supabase
          .from("payments")
          .select("id,student_reg,amount,method,status,paid_on,payment_reference")
          .order("created_at", { ascending: false }),
        supabase
          .from("room_applications")
          .select("id,student_reg,room_number,status,created_at")
          .order("created_at", { ascending: false }),
      ]);

      [
        studentResult,
        roomResult,
        allocationResult,
        paymentResult,
        applicationResult,
      ].forEach(({ error: queryError }) => {
        if (queryError) throw queryError;
      });

      // Older uploads were saved under the student's registration number.
      // Current uploads are saved under the admin's user ID. Keep the full
      // object path with each result so open/delete always target the exact key.
      const filePrefixes = [
        user.id,
        ...(activeProfile.role === "admin"
          ? (studentResult.data || []).map((student) => String(student.reg))
          : []),
      ].filter((prefix, index, all) => prefix && all.indexOf(prefix) === index);
      const fileLists = await Promise.all(
        filePrefixes.map(async (prefix) => {
          const { data, error: listError } = await supabase.storage
            .from(FILE_BUCKET)
            .list(prefix, {
              sortBy: { column: "created_at", order: "desc" },
            });
          if (listError) throw listError;
          return (data || []).map((file) => ({
            ...file,
            objectPath: `${prefix}/${file.name}`,
          }));
        }),
      );

      setStudents((studentResult.data || []).map((student) => ({ ...student })));
      setRooms(
        (roomResult.data || []).map((room) => ({
          roomNumber: room.room_number,
          roomCapacity: room.capacity,
          occupancy: room.occupied,
        })),
      );
      setAllocations(
        (allocationResult.data || []).map((item) => ({
          student: item.student_reg,
          room: item.room_number,
        })),
      );
      setPayments(
        (paymentResult.data || []).map((payment) => ({
          id: payment.id,
          student: payment.student_reg,
          amount: Number(payment.amount),
          method: payment.method,
          status: payment.status,
          date: payment.paid_on,
          reference: payment.payment_reference,
        })),
      );
      setFiles(
        fileLists.flat().filter(
          (file, index, all) =>
            all.findIndex((candidate) => candidate.objectPath === file.objectPath) === index,
        ),
      );
      setRoomApplications(applicationResult.data || []);
    } catch (loadError) {
      setError(
        loadError.message ||
          "Could not load your Supabase data. Check your database setup and policies.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) {
      loadData();
    } else {
      setPage("Dashboard");
      setStudents([]);
      setProfile(null);
      setRooms([]);
      setAllocations([]);
      setPayments([]);
      setFiles([]);
      setRoomApplications([]);
    }
  }, [user, refreshKey]);

  async function runAction(action, successMessage) {
    setError("");
    setMessage("");

    try {
      await action();
      await loadData();
      if (successMessage) setMessage(successMessage);
    } catch (actionError) {
      setError(actionError.message || "The request could not be completed.");
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      const signingUp = authMode === "signup";
      if (signingUp && (!signupName.trim() || !signupReg.trim() || !signupPhone.trim())) {
        setError("Enter your full name, student registration number, and phone number.");
        return;
      }

      const result = signingUp
        ? await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: {
                student_name: signupName.trim(),
                student_reg: signupReg.trim(),
                student_phone: signupPhone.trim(),
              },
            },
          })
        : await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });

      if (result.error) {
        setError(result.error.message);
        return;
      }

      if (signingUp && !result.data.session) {
        setMessage("Account created. Confirm your email, then log in. Your student details will be submitted automatically.");
        return;
      }

      const signedInUser = result.data.user;
      const metadata = signedInUser?.user_metadata || {};
      if (
        signedInUser &&
        metadata.student_name &&
        metadata.student_reg &&
        metadata.student_phone &&
        !metadata.student_registration_submitted
      ) {
        const { error: registrationError } = await supabase.rpc("register_student", {
          p_reg: metadata.student_reg,
          p_name: metadata.student_name,
          p_phone: metadata.student_phone,
        });
        const alreadySubmitted = registrationError?.message?.includes("already submitted");
        if (registrationError && !alreadySubmitted) throw registrationError;

        const { error: metadataError } = await supabase.auth.updateUser({
          data: { student_registration_submitted: true },
        });
        if (metadataError) throw metadataError;
        setRefreshKey((key) => key + 1);
        setMessage("Your student account is ready. Your registration has been submitted for admin verification.");
      }
    } catch (authError) {
      setError(authError.message || "Authentication could not be completed.");
    }
  }

  async function sendPasswordReset(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim()) {
      setError("Enter the email address used for the student account first.");
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: window.location.origin },
    );
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setMessage("If an account uses that email, a password reset link has been sent. Check the inbox and spam folder.");
  }

  async function saveNewPassword(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (newPassword.length < 6) {
      setError("Choose a password with at least 6 characters.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNewPassword("");
    setRecoveryMode(false);
    setAuthMode("login");
    setMessage("Password updated. You can now log in with your new password.");
    await supabase.auth.signOut();
  }

  async function reviewStudentRegistration(studentReg, decision) {
    await runAction(async () => {
      const { error: reviewError } = await supabase.rpc("review_student_registration", {
        p_student_reg: studentReg,
        p_decision: decision,
      });
      if (reviewError) throw reviewError;
    }, `Student registration ${decision}.`);
  }

  async function submitStudentRegistration(event) {
    event.preventDefault();
    if (!registrationName.trim() || !registrationReg.trim() || !registrationPhone.trim()) {
      setError("Enter your full name, student registration number, and phone number.");
      return;
    }

    await runAction(async () => {
      const { error: registrationError } = await supabase.rpc("register_student", {
        p_reg: registrationReg.trim(),
        p_name: registrationName.trim(),
        p_phone: registrationPhone.trim(),
      });
      if (registrationError) throw registrationError;
      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          student_name: registrationName.trim(),
          student_reg: registrationReg.trim(),
          student_phone: registrationPhone.trim(),
          student_registration_submitted: true,
        },
      });
      if (metadataError) throw metadataError;
    }, "Your registration was submitted. The admin must approve it before you can apply for a room or submit payment.");

    setRegistrationName("");
    setRegistrationReg("");
    setRegistrationPhone("");
  }

  async function uploadStudentDocument(event, studentReg) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("Files must be 10 MB or smaller.");
      event.currentTarget.value = "";
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeReg = String(studentReg).replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = `${user.id}/${safeReg}-${Date.now()}-${safeName}`;

    await runAction(async () => {
      const { error: uploadError } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(filePath, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw uploadError;
    }, "Student document uploaded successfully.");

    event.currentTarget.value = "";
  }

  async function addRoom() {
    if (!roomNumber.trim() || !roomCapacity.trim()) {
      setError("Please fill in all room fields.");
      return;
    }

    const capacity = Number(roomCapacity);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      setError("Room capacity must be a whole number greater than zero.");
      return;
    }

    await runAction(async () => {
      const { error: insertError } = await supabase.from("rooms").insert({
        room_number: roomNumber.trim(),
        capacity,
      });
      if (insertError) throw insertError;
    }, "Room added successfully.");

    setRoomNumber("");
    setRoomCapacity("");
  }

  async function editRoom(room) {
    const nextCapacity = window.prompt(
      "Room capacity",
      String(room.roomCapacity),
    );
    if (nextCapacity === null) return;

    const capacity = Number(nextCapacity);
    if (
      !Number.isInteger(capacity) ||
      capacity < getRoomOccupancy(room.roomNumber)
    ) {
      setError(
        "Capacity must be a whole number at least as large as current occupancy.",
      );
      return;
    }

    await runAction(async () => {
      const { error: updateError } = await supabase
        .from("rooms")
        .update({ capacity })
        .eq("room_number", room.roomNumber);
      if (updateError) throw updateError;
    }, "Room updated.");
  }

  async function deleteRoom(roomToDelete) {
    await runAction(async () => {
      const { error: deleteError } = await supabase
        .from("rooms")
        .delete()
        .eq("room_number", roomToDelete);
      if (deleteError) throw deleteError;
    }, "Room deleted. Its allocations were also removed.");
  }

  async function applyForRoom(roomNumber) {
    if (profile?.role !== "student") {
      setError("Please log in with a student account.");
      return;
    }

    if (!profile.student_reg) {
      setError(
        "Your account is not connected to your student registration yet. Please contact your hostel admin.",
      );
      return;
    }

    const room = rooms.find((item) => item.roomNumber === roomNumber);

    if (!room || getRoomOccupancy(roomNumber) >= room.roomCapacity) {
      setError("This room is no longer available.");
      return;
    }

    if (allocations.some((item) => item.student === profile.student_reg)) {
      setError("You already have a room allocation.");
      return;
    }

    if (
      roomApplications.some(
        (item) =>
          item.student_reg === profile.student_reg &&
          item.status === "pending",
      )
    ) {
      setError("You already have an application waiting for review.");
      return;
    }

    await runAction(async () => {
      const { error: submitError } = await supabase.rpc(
        "submit_room_application",
        { p_room_number: roomNumber },
      );
      if (submitError) throw submitError;
    }, "Your room application was submitted.");
  }

  async function reviewRoomApplication(applicationId, decision) {
    await runAction(async () => {
      const { error: reviewError } = await supabase.rpc(
        "review_room_application",
        { p_application_id: applicationId, p_decision: decision },
      );
      if (reviewError) throw reviewError;
    }, `Room application ${decision}.`);
  }

  async function submitStudentPayment() {
    const amount = Number(studentPaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }

    await runAction(async () => {
      const { error: submitError } = await supabase.rpc("submit_student_payment", {
        p_amount: amount,
        p_method: studentPaymentMethod,
        p_reference: studentPaymentReference.trim() || null,
      });
      if (submitError) throw submitError;
    }, "Payment submitted for admin confirmation.");
    setStudentPaymentAmount("");
    setStudentPaymentReference("");
  }

  async function confirmStudentPayment(paymentId) {
    await runAction(async () => {
      const { error: updateError } = await supabase
        .from("payments")
        .update({ status: "Paid" })
        .eq("id", paymentId)
        .eq("status", "Pending");
      if (updateError) throw updateError;
    }, "Payment confirmed.");
  }

  async function uploadFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError("Files must be 10 MB or smaller.");
      input.value = "";
      return;
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${user.id}/${crypto.randomUUID()}-${
      fileStudent ? `${fileStudent}-` : ""
    }${safeName}`;

    await runAction(async () => {
      const { error: uploadError } = await supabase.storage
        .from(FILE_BUCKET)
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw uploadError;
    }, "File uploaded to private Supabase Storage.");

    input.value = "";
  }

  async function deleteFile(objectPath) {
    await runAction(async () => {
      const { error: deleteError } = await supabase.storage
        .from(FILE_BUCKET)
        .remove([objectPath]);
      if (deleteError) throw deleteError;
    }, "File deleted.");
  }

  async function openFile(objectPath) {
    const { data, error: linkError } = await supabase.storage
      .from(FILE_BUCKET)
      .createSignedUrl(objectPath, 60);

    if (linkError) {
      setError(linkError.message);
    } else {
      window.location.assign(data.signedUrl);
    }
  }

  function getStudentName(registrationNumber) {
    const student = students.find((item) => item.reg === registrationNumber);
    return student ? student.name : registrationNumber;
  }

  function getRoomOccupancy(roomValue) {
    return rooms.find((item) => item.roomNumber === roomValue)?.occupancy || 0;
  }

  const totalPaid = payments
    .filter((payment) => payment.status === "Paid")
    .reduce((total, payment) => total + payment.amount, 0);
  const myStudent = students.find((student) => student.auth_user_id === user?.id);
  const myPayments = payments.filter(
    (payment) => payment.student === profile?.student_reg,
  );
  const canSubmitPayment =
    allocations.some((item) => item.student === profile?.student_reg) ||
    roomApplications.some(
      (item) =>
        item.student_reg === profile?.student_reg &&
        ["pending", "approved"].includes(item.status),
    );

  if (!isSupabaseConfigured) {
    return (
      <main className="auth-screen" style={styles.auth}>
<style>{`.auth-screen h1 { color: white; text-shadow: 0 2px 18px rgba(0,0,0,.3); } .auth-screen h2, .auth-screen p { color: white; } .auth-screen input { width: 100%; min-height: 46px; border-radius: 12px; border: 1px solid rgba(255,255,255,.45); padding: 12px 15px; background: rgba(255,255,255,.96); font: inherit; } .auth-screen button { border: 0; border-radius: 12px; padding: 12px 18px; margin: 4px; background: #d7a957; color: #1e3329; font-weight: 700; cursor: pointer; } .auth-screen button:hover { background: #edc675; }`}</style>
        <h1>Connect Supabase</h1>
        <p>
          Create a <code>.env</code> file using <code>.env.example</code>, then
          add your Supabase project URL and anon/publishable key. Restart{" "}
          <code>npm.cmd run dev</code>.
        </p>
      </main>
    );
  }

  if (!authReady) {
    return <main className="auth-screen" style={styles.auth}>
<style>{`.auth-screen h1 { color: white; text-shadow: 0 2px 18px rgba(0,0,0,.3); } .auth-screen h2, .auth-screen p { color: white; } .auth-screen input { width: 100%; min-height: 46px; border-radius: 12px; border: 1px solid rgba(255,255,255,.45); padding: 12px 15px; background: rgba(255,255,255,.96); font: inherit; } .auth-screen button { border: 0; border-radius: 12px; padding: 12px 18px; margin: 4px; background: #d7a957; color: #1e3329; font-weight: 700; cursor: pointer; } .auth-screen button:hover { background: #edc675; }`}</style>Loading your session…</main>;
  }

  if (recoveryMode) {
    return (
      <main className="auth-screen" style={styles.auth}>
<style>{`.auth-screen h1 { color: white; text-shadow: 0 2px 18px rgba(0,0,0,.3); } .auth-screen h2, .auth-screen p { color: white; } .auth-screen input { width: 100%; min-height: 46px; border-radius: 12px; border: 1px solid rgba(255,255,255,.45); padding: 12px 15px; background: rgba(255,255,255,.96); font: inherit; } .auth-screen button { border: 0; border-radius: 12px; padding: 12px 18px; margin: 4px; background: #d7a957; color: #1e3329; font-weight: 700; cursor: pointer; } .auth-screen button:hover { background: #edc675; }`}</style>
        <h1>Choose a new password</h1>
        <form onSubmit={saveNewPassword} style={styles.form}>
          <input
            type="password"
            autoComplete="new-password"
            minLength={6}
            placeholder="New password (at least 6 characters)"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <button type="submit">Save new password</button>
        </form>
        {error && <p role="alert" style={styles.error}>{error}</p>}
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen" style={styles.auth}>
<style>{`.auth-screen h1 { color: white; text-shadow: 0 2px 18px rgba(0,0,0,.3); } .auth-screen h2, .auth-screen p { color: white; } .auth-screen input { width: 100%; min-height: 46px; border-radius: 12px; border: 1px solid rgba(255,255,255,.45); padding: 12px 15px; background: rgba(255,255,255,.96); font: inherit; } .auth-screen button { border: 0; border-radius: 12px; padding: 12px 18px; margin: 4px; background: #d7a957; color: #1e3329; font-weight: 700; cursor: pointer; } .auth-screen button:hover { background: #edc675; }`}</style>
        <h1 style={{ fontSize: "32px", lineHeight: "1.2", marginBottom: "20px" }}>
          Hostel Management System
        </h1>
        <h2>{authMode === "login" ? "Log in" : "Create account"}</h2>

        {authMode === "signup" && (
          <p>Create your student account here. You can then sign in to view rooms, apply, and submit payment details.</p>
        )}

        <form onSubmit={submitAuth} style={styles.form}>
          {authMode === "signup" && (
            <>
              <input
                type="text"
                autoComplete="name"
                placeholder="Full name"
                value={signupName}
                onChange={(event) => setSignupName(event.target.value)}
                required
              />
              <input
                type="text"
                autoComplete="off"
                placeholder="Student registration number"
                value={signupReg}
                onChange={(event) => setSignupReg(event.target.value)}
                required
              />
              <input
                type="tel"
                autoComplete="tel"
                placeholder="Phone number"
                value={signupPhone}
                onChange={(event) => setSignupPhone(event.target.value)}
                required
              />
            </>
          )}
          <input
            type="email"
            autoComplete="email"
            placeholder="Email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            type="password"
            autoComplete={
              authMode === "login" ? "current-password" : "new-password"
            }
            minLength={6}
            placeholder="Password (at least 6 characters)"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit">
            {authMode === "login" ? "Log in" : "Create student account"}
          </button>
        </form>

        <button
          onClick={() => {
            setAuthMode(authMode === "login" ? "signup" : "login");
            setError("");
            setMessage("");
          }}
        >
          {authMode === "login"
          ? "New student? Register here"
            : "Already registered? Log in"}
        </button>

        {authMode === "login" && (
          <p>
            <button type="button" onClick={sendPasswordReset}>
              Forgot password?
            </button>
          </p>
        )}

        {message && <p role="status">{message}</p>}
        {error && (
          <p role="alert" style={styles.error}>
            {error}
          </p>
        )}
      </main>
    );
  }

  return (
    <div
      style={{
        maxWidth: "1100px",
        margin: "28px auto",
        padding: "clamp(18px, 4vw, 42px)",
        fontFamily: "Inter, Arial, sans-serif",
        background: "#fffdf8",
        minHeight: "calc(100vh - 56px)",
        borderRadius: "26px",
        boxShadow: "0 24px 70px rgba(32, 54, 48, .12)",
      }}
    >
      <style>{`* { box-sizing: border-box; } body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #e8f0e8 0%, #f6efe4 55%, #e8eee8 100%); color: #24352f; font-family: Inter, Arial, sans-serif; } h1, h2, h3 { color: #23463b; } button { border: 0; border-radius: 10px; padding: 10px 15px; margin: 3px 2px; background: #315e4b; color: white; font-weight: 650; cursor: pointer; } button:hover { background: #234638; } input, select { max-width: 100%; border: 1px solid #d8dfd5; border-radius: 10px; background: white; padding: 12px 14px; font: inherit; } hr { border: 0; border-top: 1px solid #e4e8e0; margin: 20px 0; } .room-photo { width: 100%; height: 190px; object-fit: cover; display: block; border-radius: 16px; margin-bottom: 14px; } .room-card { background: #fff; border: 1px solid #e6e8df; border-radius: 20px; padding: 16px; box-shadow: 0 10px 28px rgba(34, 60, 48, .08); } .hostel-hero { min-height: 230px; display: flex; align-items: end; padding: 26px; margin: 22px 0; border-radius: 22px; color: white; background: linear-gradient(90deg, rgba(18,43,34,.82), rgba(18,43,34,.08)), url("https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1600&q=85") center 55%/cover; } .hostel-hero h2 { color: white; font-size: clamp(24px, 4vw, 36px); margin: 0; }`}</style>      <h1>Hostel Management System</h1>
      <p>
        Signed in as {user.email}{" "}
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </p>

      {/* Navigation: students see Dashboard and Rooms; admins see management pages. */}
      <button onClick={() => setPage("Dashboard")}>Dashboard</button>{" "}
      {profile?.role === "student" && (
        <>
          <button onClick={() => setPage("Student Registration")}>My Registration</button>{" "}
          {profile.student_reg && <>
            <button onClick={() => setPage("Rooms")}>Rooms</button>{" "}
            {canSubmitPayment && (
              <button onClick={() => setPage("Student Payments")}>Payments</button>
            )}
          </>}
        </>
      )}
      {profile?.role === "admin" && (
        <>
          <button onClick={() => setPage("Students")}>Students</button>{" "}
          <button onClick={() => setPage("Rooms")}>Rooms</button>{" "}
          <button onClick={() => setPage("Payments")}>Payments</button>
        </>
      )}

      <hr />

      {message && (
        <p role="status" style={styles.success}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      )}
      {loading && <p>Loading your Supabase data…</p>}

      {page === "Dashboard" && (
        <div>
          <section className="hostel-hero"><div><h2>Find your place to feel at home</h2><p>Comfortable student living, made simple.</p></div></section>
          <h2>Dashboard</h2>
          <p>Welcome to the Hostel Management System.</p>

          {profile?.role === "admin" ? (
            <>
              <p>Total Students: {students.length}</p>
              <p>Total Rooms: {rooms.length}</p>
              <p>Total Allocations: {allocations.length}</p>
              <p>Total Payments Received: UGX {totalPaid.toLocaleString()}</p>
              <p>
                Pending room applications:{" "}
                {roomApplications.filter((item) => item.status === "pending").length}
              </p>
            </>
          ) : (
            <>
              <p>Account role: Student</p>
              {myStudent ? <p>Registration {myStudent.reg}: {myStudent.verification_status}</p> : <p>Complete student registration to continue.</p>}
            </>
          )}
        </div>
      )}

      {profile?.role === "admin" && page === "Students" && (
        <div>
          <h2>Students</h2>
          <h3>Student Sign-up Requests</h3>
          {students.length === 0 ? (
            <p>No students registered yet.</p>
          ) : (
            students.map((student) => (
              <div key={student.reg}>
                <p>
                  {student.name} | {student.reg} | {student.phone} | Verification: {student.verification_status || "approved"}
                </p>
                {student.verification_status === "pending" && <>
                  <button disabled={loading} onClick={() => reviewStudentRegistration(student.reg, "approved")}>Approve registration</button>{" "}
                  <button disabled={loading} onClick={() => reviewStudentRegistration(student.reg, "rejected")}>Reject registration</button>
                </>}{" "}
                <hr />
                <input
                  type="file"
                  onChange={(event) =>
                    uploadStudentDocument(event, student.reg)
                  }
                />
                <hr />
              </div>
            ))
          )}

          <h3>Student Documents</h3>
          <p>
            Upload a private file (maximum 10 MB) to this account’s Supabase
            Storage.
          </p>
          <select
            value={fileStudent}
            onChange={(event) => setFileStudent(event.target.value)}
          >
            <option value="">No student selected</option>
            {students.map((student) => (
              <option key={student.reg} value={student.reg}>
                {student.name} - {student.reg}
              </option>
            ))}
          </select>{" "}
          <input type="file" onChange={uploadFile} />

          {files.length === 0 ? (
            <p>No uploaded files yet.</p>
          ) : (
            files.map((file) => (
              <p key={file.objectPath}>
                {file.name}{" "}
                <button onClick={() => openFile(file.objectPath)}>Open</button>{" "}
                <button onClick={() => deleteFile(file.objectPath)}>
                  Delete file
                </button>
              </p>
            ))
          )}
        </div>
      )}

      {/* Student-only room browsing and application page. */}
      {profile?.role === "student" && page === "Student Registration" && (
        <div>
          <h2>Student Registration</h2>
          {myStudent ? (
            <p>Registration {myStudent.reg} is {myStudent.verification_status}. {myStudent.verification_status === "pending" ? "An admin must approve it before you can apply for a room." : "You can now apply for a room and submit payment."}</p>
          ) : (
            <>
              <p>Enter your details below to register yourself. The admin will review your registration.</p>
              <form onSubmit={submitStudentRegistration} style={styles.form}>
                <input type="text" autoComplete="name" placeholder="Full name" value={registrationName} onChange={(event) => setRegistrationName(event.target.value)} required />
                <input type="text" placeholder="Student registration number" value={registrationReg} onChange={(event) => setRegistrationReg(event.target.value)} required />
                <input type="tel" autoComplete="tel" placeholder="Phone number" value={registrationPhone} onChange={(event) => setRegistrationPhone(event.target.value)} required />
                <button type="submit" disabled={loading}>Submit student registration</button>
              </form>
            </>
          )}
        </div>
      )}

      {profile?.role === "student" && page === "Rooms" && (
        <div>
          <h2>Available Rooms</h2>

          {!profile.student_reg ? (
            <p>Your registration must be approved by an admin before you can apply.</p>
          ) : allocations.some(
              (item) => item.student === profile.student_reg,
            ) ? (
            <p>
              You already have a room: Room{" "}
              {
                allocations.find(
                  (item) => item.student === profile.student_reg,
                ).room
              }
              .
            </p>
          ) : (
            <>
              {roomApplications.some(
                (item) =>
                  item.student_reg === profile.student_reg &&
                  item.status === "pending",
              ) && <p>Your room application is awaiting admin review.</p>}

              {rooms.filter(
                (room) =>
                  getRoomOccupancy(room.roomNumber) < room.roomCapacity,
              ).length === 0 ? (
                <p>No rooms are available right now.</p>
              ) : (
                rooms
                  .filter(
                    (room) =>
                      getRoomOccupancy(room.roomNumber) < room.roomCapacity,
                  )
                  .map((room) => {
                    const occupancy = getRoomOccupancy(room.roomNumber);
                    const hasPendingApplication = roomApplications.some(
                      (item) =>
                        item.student_reg === profile.student_reg &&
                        item.status === "pending",
                    );

                    return (
                      <div className="room-card" key={room.roomNumber}>
                        <img className="room-photo" src="https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=900&q=80" alt={`A welcoming hostel room, Room ${room.roomNumber}`} loading="lazy" />
                        <h3>Room {room.roomNumber}</h3>
                        <p>
                          {room.roomCapacity - occupancy} place(s) available
                          {" "}({occupancy}/{room.roomCapacity} occupied)
                        </p>
                        <button
                          type="button"
                          onClick={() => applyForRoom(room.roomNumber)}
                          disabled={loading || hasPendingApplication}
                        >
                          {hasPendingApplication
                            ? "Application pending"
                            : "Apply for this room"}
                        </button>
                        <hr />
                      </div>
                    );
                  })
              )}

              <h3>Your applications</h3>
              {roomApplications.filter(
                (item) => item.student_reg === profile.student_reg,
              ).length === 0 ? (
                <p>You have not submitted a room application.</p>
              ) : (
                roomApplications
                  .filter(
                    (item) => item.student_reg === profile.student_reg,
                  )
                  .map((application) => (
                    <p key={application.id}>
                      Room {application.room_number} — {application.status}
                    </p>
                  ))
              )}
            </>
          )}
        </div>
      )}

      {/* Admin-only room management. */}
      {profile?.role === "admin" && page === "Rooms" && (
        <div>
          <h2>Rooms</h2>

          <h3>Add Room</h3>
          <input
            placeholder="Room Number"
            value={roomNumber}
            onChange={(event) => setRoomNumber(event.target.value)}
          />
          <br />
          <br />
          <input
            type="number"
            min="1"
            placeholder="Room Capacity"
            value={roomCapacity}
            onChange={(event) => setRoomCapacity(event.target.value)}
          />
          <br />
          <br />
          <button onClick={addRoom}>Add Room</button>
          <h3>Room Applications (approval assigns the room)</h3>
          {roomApplications.length === 0 ? (
            <p>No room applications yet.</p>
          ) : (
            roomApplications.map((application) => (
              <div key={application.id}>
                <p>
                  {getStudentName(application.student_reg)} (
                  {application.student_reg}) — Room {application.room_number}
                  <br />
                  Status: {application.status}
                  <br />
                  Submitted: {new Date(application.created_at).toLocaleString()}
                </p>

                {application.status === "pending" && (
                  <>
                    <button
                      onClick={() =>
                        reviewRoomApplication(application.id, "approved")
                      }
                      disabled={loading}
                    >
                      Approve
                    </button>{" "}
                    <button
                      onClick={() =>
                        reviewRoomApplication(application.id, "rejected")
                      }
                      disabled={loading}
                    >
                      Reject
                    </button>
                  </>
                )}
                <hr />
              </div>
            ))
          )}

          <h3>Rooms List</h3>
          {rooms.length === 0 ? (
            <p>No rooms added yet.</p>
          ) : (
            rooms.map((room) => (
              <div className="room-card" key={room.roomNumber}>
                <p>
                  Room {room.roomNumber} — Capacity: {room.roomCapacity} —
                  Occupied: {getRoomOccupancy(room.roomNumber)}
                </p>
                <hr />
              </div>
            ))
          )}

          <h3>Allocated Rooms</h3>
          {allocations.length === 0 ? (
            <p>No room allocations yet.</p>
          ) : (
            allocations.map((allocation) => (
              <div key={allocation.student}>
                <p>
                  {getStudentName(allocation.student)} ({allocation.student}) —
                  Room {allocation.room}
                </p>
                <hr />
              </div>
            ))
          )}
        </div>
      )}

      {profile?.role === "admin" && page === "Payments" && (
        <div>
          <h2>Payments Management</h2>
          <p>Review student-submitted payments and confirm them after checking the receipt or transaction reference.</p>
          <h3>Payment Summary</h3>
          <p>Total Paid: UGX {totalPaid.toLocaleString()}</p>

          <h3>Payment History</h3>
          {payments.length === 0 ? (
            <p>No payments recorded yet.</p>
          ) : (
            payments.map((payment) => (
              <div key={payment.id}>
                <p>
                  Student: {getStudentName(payment.student)} ({payment.student})
                  <br />
                  Amount: UGX {payment.amount.toLocaleString()}
                  <br />
                  Method: {payment.method}
                  {payment.reference && <><br />Reference: {payment.reference}</>}
                  <br />
                  Status: {payment.status}
                  <br />
                  Date: {payment.date}
                </p>
                {payment.status === "Pending" && (
                  <button disabled={loading} onClick={() => confirmStudentPayment(payment.id)}>
                    Confirm payment
                  </button>
                )}{" "}
                <hr />
              </div>
            ))
          )}
        </div>
      )}

      {profile?.role === "student" && profile.student_reg && page === "Student Payments" && (
        <div>
          <h2>My Payments</h2>
          <p>Submit payment details here. The admin will confirm the payment after checking it.</p>
          <form onSubmit={(event) => { event.preventDefault(); void submitStudentPayment(); }} style={styles.form}>
            <input type="number" min="1" step="0.01" placeholder="Amount (UGX)" value={studentPaymentAmount} onChange={(event) => setStudentPaymentAmount(event.target.value)} required />
            <select value={studentPaymentMethod} onChange={(event) => setStudentPaymentMethod(event.target.value)}>
              <option value="M-Pesa">M-Pesa</option><option value="Bank">Bank</option><option value="Cash">Cash</option><option value="Card">Card</option>
            </select>
            <input placeholder="Transaction reference / receipt number" value={studentPaymentReference} onChange={(event) => setStudentPaymentReference(event.target.value)} />
            <button type="submit" disabled={loading}>Submit payment for confirmation</button>
          </form>
          <h3>Payment history</h3>
          {myPayments.length === 0 ? <p>No payments submitted yet.</p> : myPayments.map((payment) => (
            <p key={payment.id}>UGX {payment.amount.toLocaleString()} — {payment.method} — {payment.status}{payment.reference ? ` — Reference: ${payment.reference}` : ""}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
