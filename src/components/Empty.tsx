export default function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span>
        <Icon size={25} strokeWidth={1.4} />
      </span>
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}
